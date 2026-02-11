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
 * Build conversation context from chat history
 */
function buildConversationContext(chatHistory?: ChatMessage[]): string {
  if (!chatHistory?.length) return '';

  const relevant = chatHistory.slice(-6); // Last 6 messages for context
  
  return relevant
    .map(msg => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      // Truncate long messages
      const content = msg.content.length > 500 
        ? msg.content.substring(0, 500) + '...'
        : msg.content;
      return `${role}: ${content}`;
    })
    .join('\n\n');
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
 * Build the full prompt for SQL generation
 */
function buildPrompt(
  userMessage: string,
  schemaContext: string,
  conversationContext: string
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

  // Add conversation context if available
  if (conversationContext) {
    messages.push({
      role: 'system',
      content: `Previous conversation:\n${conversationContext}`,
    });
  }

  // Add user message
  messages.push({ role: 'user', content: userMessage });

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
  const conversationContext = buildConversationContext(chatHistory);
  const messages = buildPrompt(userMessage, schemaContext, conversationContext);

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
  const conversationContext = buildConversationContext(chatHistory);
  const messages = buildPrompt(userMessage, schemaContext, conversationContext);

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
