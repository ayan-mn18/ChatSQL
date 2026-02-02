// ============================================
// STREAMING CHAT SERVICE
// Handles streaming AI responses with proper intent routing
// ============================================

import { Response } from 'express';
import { stream, getModelForTier, ChatMessage as LLMChatMessage } from './llm';
import { classifyIntent, ChatIntent, isLikelySqlRelated } from './intent-classifier';
import { streamSqlGeneration, generateSql } from './sql-generator.service';
import { logger } from '../utils/logger';
import type { ChatMessage } from '../services/chat.service';

export interface StreamChatConfig {
  connectionId: string;
  userId: string;
  sessionId: string;
  selectedSchemas: string[];
  schemaContext: string;
  chatHistory?: ChatMessage[];
}

export interface StreamChatResult {
  intent: ChatIntent;
  content: string;
  sql?: string;
  tablesUsed?: string[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

const GENERAL_CHAT_SYSTEM_PROMPT = `You are a friendly database assistant. You help users with their database questions and can help them write SQL queries.

Keep responses concise and helpful. If the user seems to want a SQL query, let them know you can help generate one - just ask them to be more specific about what data they need.

You have access to their database schema, so you can answer questions about tables, columns, and relationships.`;

const CLARIFICATION_SYSTEM_PROMPT = `You are a database assistant helping a user write SQL queries.

The user's request is unclear. Ask a brief, friendly clarifying question to understand:
- What tables/data they want to query
- What conditions or filters they need
- How they want the results sorted or grouped

Keep your question short and specific.`;

/**
 * Stream a chat response to the client
 * Routes to appropriate handler based on intent
 */
export async function streamChatResponse(
  message: string,
  res: Response,
  config: StreamChatConfig
): Promise<StreamChatResult> {
  const { schemaContext, chatHistory, connectionId } = config;

  // Quick check if SQL-related
  const likelySql = isLikelySqlRelated(message);

  // Classify intent (uses fast model)
  let intent: ChatIntent;
  
  if (likelySql) {
    // For obviously SQL-related messages, skip full classification
    const result = await classifyIntent(message, {
      recentMessages: chatHistory?.slice(-3).map(m => ({ role: m.role, content: m.content })),
      hasSchema: !!schemaContext,
    });
    intent = result.intent;
  } else {
    // Quick fallback for non-SQL messages
    intent = 'general_chat';
  }

  logger.info(`[STREAM_CHAT] Intent: ${intent} for message: "${message.substring(0, 50)}..."`);

  // Route to appropriate handler
  switch (intent) {
    case 'sql_generation':
    case 'follow_up':
      return handleSqlGeneration(message, res, config, intent);
    
    case 'sql_explanation':
      return handleSqlExplanation(message, res, config);
    
    case 'clarification':
      return handleClarification(message, res, config);
    
    case 'general_chat':
    case 'off_topic':
    default:
      return handleGeneralChat(message, res, config, intent);
  }
}

/**
 * Handle SQL generation requests
 */
async function handleSqlGeneration(
  message: string,
  res: Response,
  config: StreamChatConfig,
  intent: ChatIntent
): Promise<StreamChatResult> {
  const { schemaContext, chatHistory, connectionId, selectedSchemas } = config;

  const result = await streamSqlGeneration(message, schemaContext, {
    connectionId,
    selectedSchemas,
    chatHistory,
    streamToResponse: res,
  });

  return {
    intent,
    content: result.description || '',
    sql: result.query,
    tablesUsed: result.tablesUsed,
    tokenUsage: result.tokenUsage,
  };
}

/**
 * Handle SQL explanation requests
 */
async function handleSqlExplanation(
  message: string,
  res: Response,
  config: StreamChatConfig
): Promise<StreamChatResult> {
  const { schemaContext, chatHistory } = config;

  // Extract SQL from message if present
  const sqlMatch = message.match(/```sql\n([\s\S]*?)```/) || 
                   message.match(/SELECT[\s\S]*?(?:;|$)/i);
  
  const sqlToExplain = sqlMatch ? sqlMatch[0] : message;

  const systemPrompt = `You are a SQL expert. Explain the following SQL query in plain English.

Be concise and focus on:
1. What data is being retrieved/modified
2. Key conditions and filters
3. Any JOINs and their purpose
4. Performance considerations if relevant

Database context:
${schemaContext || 'No schema available'}`;

  const messages: LLMChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Explain this SQL:\n${sqlToExplain}` },
  ];

  const { provider, model } = getModelForTier('fast');
  let fullContent = '';
  let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  return new Promise((resolve) => {
    stream(
      messages,
      {
        onChunk: (chunk) => {
          if (chunk.content) {
            fullContent += chunk.content;
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
            }
          }
          if (chunk.done && chunk.usage) {
            tokenUsage = chunk.usage;
          }
        },
        onError: (error) => {
          logger.error(`[STREAM_CHAT] Explanation error: ${error.message}`);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
          }
          resolve({ intent: 'sql_explanation', content: '', tokenUsage });
        },
        onComplete: () => {
          resolve({ intent: 'sql_explanation', content: fullContent, tokenUsage });
        },
      },
      { provider, model }
    );
  });
}

/**
 * Handle clarification requests
 */
async function handleClarification(
  message: string,
  res: Response,
  config: StreamChatConfig
): Promise<StreamChatResult> {
  const { schemaContext, chatHistory } = config;

  const recentContext = chatHistory?.slice(-4).map(m => 
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 200)}`
  ).join('\n') || '';

  const messages: LLMChatMessage[] = [
    { role: 'system', content: CLARIFICATION_SYSTEM_PROMPT },
    { role: 'system', content: `Available tables: ${schemaContext?.substring(0, 500) || 'Unknown'}` },
    ...(recentContext ? [{ role: 'system' as const, content: `Recent conversation:\n${recentContext}` }] : []),
    { role: 'user', content: message },
  ];

  const { provider, model } = getModelForTier('fast');
  let fullContent = '';
  let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  return new Promise((resolve) => {
    stream(
      messages,
      {
        onChunk: (chunk) => {
          if (chunk.content) {
            fullContent += chunk.content;
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
            }
          }
          if (chunk.done && chunk.usage) {
            tokenUsage = chunk.usage;
          }
        },
        onError: (error) => {
          logger.error(`[STREAM_CHAT] Clarification error: ${error.message}`);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
          }
          resolve({ intent: 'clarification', content: '', tokenUsage });
        },
        onComplete: () => {
          resolve({ intent: 'clarification', content: fullContent, tokenUsage });
        },
      },
      { provider, model }
    );
  });
}

/**
 * Handle general chat / off-topic
 */
async function handleGeneralChat(
  message: string,
  res: Response,
  config: StreamChatConfig,
  intent: ChatIntent
): Promise<StreamChatResult> {
  const { schemaContext, chatHistory } = config;

  const recentContext = chatHistory?.slice(-4).map(m => 
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 200)}`
  ).join('\n') || '';

  const messages: LLMChatMessage[] = [
    { role: 'system', content: GENERAL_CHAT_SYSTEM_PROMPT },
    ...(schemaContext ? [{ role: 'system' as const, content: `Database schema summary: ${schemaContext.substring(0, 1000)}` }] : []),
    ...(recentContext ? [{ role: 'system' as const, content: `Recent conversation:\n${recentContext}` }] : []),
    { role: 'user', content: message },
  ];

  const { provider, model } = getModelForTier('fast');
  let fullContent = '';
  let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  return new Promise((resolve) => {
    stream(
      messages,
      {
        onChunk: (chunk) => {
          if (chunk.content) {
            fullContent += chunk.content;
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
            }
          }
          if (chunk.done && chunk.usage) {
            tokenUsage = chunk.usage;
          }
        },
        onError: (error) => {
          logger.error(`[STREAM_CHAT] General chat error: ${error.message}`);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
          }
          resolve({ intent, content: '', tokenUsage });
        },
        onComplete: () => {
          resolve({ intent, content: fullContent, tokenUsage });
        },
      },
      { provider, model }
    );
  });
}
