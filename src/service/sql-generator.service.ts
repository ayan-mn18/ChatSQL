// ============================================
// SQL GENERATOR SERVICE
// Generates SQL using powerful model with streaming
// ============================================

import { Response } from 'express';
import { stream, complete, getModelForTier, ChatMessage as LLMChatMessage } from './llm';
import { logger } from '../utils/logger';
import { getRedisClient } from '../config/redis';
import type { ChatMessage } from '../services/chat.service';

// Cache TTL for schema context (1 hour)
const SCHEMA_CONTEXT_TTL = 3600;

export interface SqlGeneratorConfig {
  connectionId: string;
  selectedSchemas: string[];
  chatHistory?: ChatMessage[];
  streamToResponse?: Response;
}

export interface SqlGenerationResult {
  success: boolean;
  query?: string;
  reasoning?: {
    steps: string[];
    optimizationNotes: string[];
  };
  tablesUsed?: string[];
  description?: string;
  model?: string;
  provider?: string;
  error?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

const SQL_GENERATOR_SYSTEM_PROMPT = `You are an expert PostgreSQL query writer.

Response format:
1. A brief 1-2 sentence summary of what the query does
2. The SQL query in a markdown code block (\`\`\`sql ... \`\`\`)
3. If you made important assumptions, mention them in ONE short sentence after the SQL

Do NOT:
- Give long explanations or step-by-step breakdowns unless user explicitly asks "explain in detail"
- Add unnecessary commentary
- Repeat what the user asked

SQL Guidelines:
- ALWAYS use the actual table and column names from the provided database schema
- Use schema-qualified table names (e.g., public.users)
- Prefer explicit column lists over SELECT *
- Use appropriate JOINs based on relationships shown in the schema
- Add reasonable LIMITs for large result sets
- Use CTEs for complex queries to improve readability
- NEVER guess or assume table/column names — only use what exists in the schema

Error handling:
- If the user pastes a SQL error (e.g., "relation does not exist", "column not found"), fix the query using the correct table/column names from the schema
- Briefly explain what was wrong and provide the corrected query
- If the schema doesn't have what the user needs, say so clearly

Be direct. Query first, talk later.`;

/**
 * Build conversation history as proper user/assistant message turns for the LLM.
 * This gives the model real multi-turn awareness instead of a flattened text summary.
 */
function buildHistoryMessages(chatHistory?: ChatMessage[]): LLMChatMessage[] {
  if (!chatHistory?.length) return [];

  return chatHistory
    .slice(-10) // Last 10 messages for rich conversational context
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(msg => {
      let content = msg.content;
      // For assistant messages that generated SQL, include it for continuity
      if (msg.role === 'assistant' && msg.sqlGenerated) {
        content = content + '\n\n```sql\n' + msg.sqlGenerated + '\n```';
      }
      // Cap individual message length to avoid token blowup
      if (content.length > 2000) {
        content = content.substring(0, 2000) + '\n... (truncated)';
      }
      return { role: msg.role as 'user' | 'assistant', content };
    });
}

/**
 * Get cached schema context for AI
 */
async function getSchemaContext(
  connectionId: string,
  selectedSchemas: string[]
): Promise<string> {
  const redis = getRedisClient();
  const schemasKey = selectedSchemas.sort().join(',') || 'all';
  const cacheKey = `ai_context:${connectionId}:${schemasKey}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug(`[SQL_GEN] Using cached schema context for ${connectionId}`);
      return cached;
    }
  } catch (err) {
    logger.warn('[SQL_GEN] Failed to get cached schema context');
  }

  // If no cache, return empty - caller should fetch fresh
  return '';
}

/**
 * Build the full prompt for SQL generation.
 * Includes schema as system context and conversation history as proper user/assistant turns.
 */
function buildPrompt(
  userMessage: string,
  schemaContext: string,
  chatHistory?: ChatMessage[]
): LLMChatMessage[] {
  const messages: LLMChatMessage[] = [
    { role: 'system', content: SQL_GENERATOR_SYSTEM_PROMPT },
  ];

  // Add schema context if available
  if (schemaContext) {
    messages.push({
      role: 'system',
      content: `Database Schema:\n${schemaContext}`,
    });
  }

  // Add conversation history as proper user/assistant turns
  const historyMsgs = buildHistoryMessages(chatHistory);
  if (historyMsgs.length > 0) {
    messages.push(...historyMsgs);
  }

  // Add current user message (deduplicate if last history entry is identical)
  const lastMsg = historyMsgs[historyMsgs.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  return messages;
}

/**
 * Stream SQL generation directly to HTTP response
 */
export async function streamSqlGeneration(
  userMessage: string,
  schemaContext: string,
  config: SqlGeneratorConfig
): Promise<SqlGenerationResult> {
  const { streamToResponse: res, chatHistory } = config;
  const messages = buildPrompt(userMessage, schemaContext, chatHistory);

  // Use balanced tier for SQL generation (prefers Anthropic for quality)
  const { provider, model } = getModelForTier('balanced');
  logger.info(`[SQL_GEN] Using ${provider}/${model} for SQL generation`);

  let fullContent = '';
  let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  return new Promise((resolve) => {
    stream(
      messages,
      {
        onChunk: (chunk) => {
          if (chunk.content) {
            fullContent += chunk.content;
            
            // Stream to response if provided
            if (res && !res.writableEnded) {
              res.write(`data: ${JSON.stringify({ 
                type: 'content', 
                content: chunk.content 
              })}\n\n`);
            }
          }

          if (chunk.done && chunk.usage) {
            tokenUsage = chunk.usage;
          }
        },
        onError: (error) => {
          logger.error(`[SQL_GEN] Stream error: ${error.message}`);
          
          if (res && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ 
              type: 'error', 
              error: error.message 
            })}\n\n`);
          }

          resolve({
            success: false,
            error: error.message,
          });
        },
        onComplete: (response) => {
          // Extract SQL from response
          const sqlMatch = fullContent.match(/```sql\n([\s\S]*?)```/);
          const query = sqlMatch ? sqlMatch[1].trim() : undefined;

          // Extract tables mentioned (simple heuristic)
          const tableMatches = fullContent.match(/(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi);
          const tablesUsed = tableMatches 
            ? [...new Set(tableMatches.map(m => m.replace(/^(FROM|JOIN)\s+/i, '').trim()))]
            : [];

          resolve({
            success: true,
            query,
            tablesUsed,
            description: fullContent,
            model,
            provider,
            tokenUsage,
          });
        },
      },
      { provider, model }
    );
  });
}

/**
 * Generate SQL without streaming (for background jobs)
 */
export async function generateSql(
  userMessage: string,
  schemaContext: string,
  chatHistory?: ChatMessage[]
): Promise<SqlGenerationResult> {
  const messages = buildPrompt(userMessage, schemaContext, chatHistory);

  // Get balanced model for SQL generation (prefers Anthropic)
  const { provider, model } = getModelForTier('balanced');
  logger.info(`[SQL_GEN] Using ${provider}/${model} for non-streaming SQL generation`);

  try {
    const response = await complete(messages, { provider, model });

    // Extract SQL from response
    const sqlMatch = response.content.match(/```sql\n([\s\S]*?)```/);
    const query = sqlMatch ? sqlMatch[1].trim() : undefined;

    // Extract tables mentioned
    const tableMatches = response.content.match(/(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi);
    const tablesUsed = tableMatches 
      ? [...new Set(tableMatches.map(m => m.replace(/^(FROM|JOIN)\s+/i, '').trim()))]
      : [];

    return {
      success: true,
      query,
      tablesUsed,
      description: response.content,
      tokenUsage: response.usage,
    };
  } catch (error: any) {
    logger.error(`[SQL_GEN] Generation failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}
