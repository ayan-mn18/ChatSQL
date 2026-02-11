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
  model?: string;
  provider?: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

const GENERAL_CHAT_SYSTEM_PROMPT = `You are a friendly, concise database assistant.

Rules:
- Keep responses SHORT (1-3 sentences max for greetings and casual chat)
- For "hi", "hello", "hey" etc., respond with a brief friendly greeting and ask how you can help
- If the user seems to want a SQL query, suggest they ask specifically
- You have access to their database schema
- Never give long explanations unless explicitly asked`;

const CLARIFICATION_SYSTEM_PROMPT = `You are a database assistant. The user's request is unclear.

Ask ONE brief, specific clarifying question. Keep it under 2 sentences.`;

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

  // Check if SQL-related or if there's conversation history (follow-ups need context)
  const likelySql = isLikelySqlRelated(message);
  const hasConversation = chatHistory && chatHistory.length > 1;

  // Classify intent (uses fast model)
  // Always classify with LLM if there's conversation history OR if message seems SQL-related
  // This ensures error messages and follow-ups are properly detected
  let intent: ChatIntent;
  
  if (likelySql || hasConversation) {
    const result = await classifyIntent(message, {
      recentMessages: chatHistory?.slice(-4).map(m => ({ role: m.role, content: m.content })),
      hasSchema: !!schemaContext,
    });
    intent = result.intent;
  } else {
    // Only skip classification for very first messages that are clearly not SQL
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
    model: result.model,
    provider: result.provider,
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

Be concise:
1. What data is being retrieved/modified (1 sentence)
2. Key JOINs/conditions (if notable)
3. Performance note (only if there's an issue)

Keep explanation under 4 sentences unless user asks for detail.

Database context:
${schemaContext || 'No schema available'}`;

  const messages: LLMChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Explain this SQL:\n${sqlToExplain}` },
  ];

  // Use balanced tier for SQL explanation (Anthropic preferred)
  const { provider, model } = getModelForTier('balanced');
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
          resolve({ intent: 'sql_explanation', content: '', model, provider, tokenUsage });
        },
        onComplete: () => {
          resolve({ intent: 'sql_explanation', content: fullContent, model, provider, tokenUsage });
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
          resolve({ intent: 'clarification', content: '', model, provider, tokenUsage });
        },
        onComplete: () => {
          resolve({ intent: 'clarification', content: fullContent, model, provider, tokenUsage });
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
          resolve({ intent, content: '', model, provider, tokenUsage });
        },
        onComplete: () => {
          resolve({ intent, content: fullContent, model, provider, tokenUsage });
        },
      },
      { provider, model }
    );
  });
}
