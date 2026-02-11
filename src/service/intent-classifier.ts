// ============================================
// INTENT CLASSIFIER
// Uses fast/cheap model to classify user intent
// ============================================

import { quickComplete } from './llm';
import { logger } from '../utils/logger';

export type ChatIntent = 
  | 'sql_generation'      // User wants to generate SQL
  | 'sql_explanation'     // User wants to understand existing SQL
  | 'clarification'       // Need more info before generating
  | 'follow_up'           // Follow-up on previous query
  | 'general_chat'        // General conversation about DB
  | 'off_topic';          // Not related to databases

export interface IntentResult {
  intent: ChatIntent;
  confidence: number;
  reasoning: string;
  suggestedAction?: string;
}

const INTENT_CLASSIFIER_PROMPT = `You are an intent classifier for a SQL database assistant.

Classify the user's message into ONE of these intents:
- sql_generation: User wants to generate/write a SQL query
- sql_explanation: User wants to understand/explain existing SQL code
- clarification: The request is unclear and needs more information before generating SQL
- follow_up: User is responding to a previous query result, pasting an error from running a query, asking to modify/fix a previous query, or continuing the conversation about a previous query. This includes SQL error messages like "relation does not exist", "column not found", "syntax error", "permission denied", etc.
- general_chat: General questions about databases, schemas, or the tool
- off_topic: Not related to databases or SQL at all

IMPORTANT: If the user pastes a database/SQL error message, it is almost always a follow_up on a previous query they ran. NEVER classify error messages as general_chat or off_topic.

Respond with ONLY a JSON object:
{
  "intent": "<intent_type>",
  "confidence": <0.0-1.0>,
  "reasoning": "<brief explanation>",
  "suggestedAction": "<optional: what to do next>"
}`;

/**
 * Classify user message intent using a fast/cheap model
 */
export async function classifyIntent(
  message: string,
  context?: {
    recentMessages?: Array<{ role: string; content: string }>;
    hasSchema?: boolean;
  }
): Promise<IntentResult> {
  const startTime = Date.now();

  // Build context string
  let contextInfo = '';
  if (context?.recentMessages?.length) {
    const recent = context.recentMessages.slice(-3);
    contextInfo = `\n\nRecent conversation:\n${recent.map(m => `${m.role}: ${m.content.substring(0, 100)}...`).join('\n')}`;
  }
  if (context?.hasSchema !== undefined) {
    contextInfo += `\n\nDatabase schema available: ${context.hasSchema ? 'Yes' : 'No'}`;
  }

  const prompt = `User message: "${message}"${contextInfo}

Classify the intent of this message.`;

  try {
    const response = await quickComplete(prompt, {
      tier: 'fast',
      systemPrompt: INTENT_CLASSIFIER_PROMPT,
      temperature: 0.1, // Low temperature for consistent classification
    });

    // Parse the JSON response
    const cleaned = response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const result = JSON.parse(cleaned) as IntentResult;
    
    const elapsed = Date.now() - startTime;
    logger.info(`[INTENT] Classified "${message.substring(0, 30)}..." as ${result.intent} (${result.confidence}) in ${elapsed}ms`);

    return result;
  } catch (error: any) {
    logger.error(`[INTENT] Classification failed: ${error.message}`);
    
    // Fallback to keyword-based classification
    return fallbackClassification(message);
  }
}

/**
 * Fallback keyword-based classification when LLM fails
 */
function fallbackClassification(message: string): IntentResult {
  const lower = message.toLowerCase();

  // SQL generation keywords
  const sqlGenKeywords = [
    'write', 'generate', 'create query', 'sql for', 'query to',
    'select', 'insert', 'update', 'delete', 'show me', 'get all',
    'find all', 'list all', 'how many', 'count', 'sum', 'average',
    'fetch', 'retrieve', 'give me'
  ];

  // SQL explanation keywords
  const explainKeywords = [
    'explain', 'what does', 'understand', 'meaning of', 'analyze',
    'break down', 'describe this'
  ];

  // Follow-up keywords (including SQL error patterns)
  const followUpKeywords = [
    'also', 'and add', 'modify', 'change it', 'instead', 'but',
    'what about', 'same but', 'previous', 'last query',
    'does not exist', 'not found', 'syntax error', 'error',
    'permission denied', 'fix', 'wrong', 'incorrect', 'try again'
  ];

  // Check for SQL code in message
  const hasSqlCode = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\b/i.test(message);

  if (hasSqlCode && explainKeywords.some(k => lower.includes(k))) {
    return {
      intent: 'sql_explanation',
      confidence: 0.7,
      reasoning: 'Message contains SQL code with explanation keywords',
    };
  }

  if (followUpKeywords.some(k => lower.includes(k))) {
    return {
      intent: 'follow_up',
      confidence: 0.6,
      reasoning: 'Message contains follow-up indicators',
    };
  }

  if (sqlGenKeywords.some(k => lower.includes(k))) {
    return {
      intent: 'sql_generation',
      confidence: 0.7,
      reasoning: 'Message contains SQL generation keywords',
    };
  }

  // Default to general chat
  return {
    intent: 'general_chat',
    confidence: 0.5,
    reasoning: 'Fallback classification - no strong indicators',
  };
}

/**
 * Quick check if message is likely SQL-related (very fast, no LLM call)
 */
export function isLikelySqlRelated(message: string): boolean {
  const lower = message.toLowerCase();
  
  const sqlIndicators = [
    // SQL keywords
    'sql', 'query', 'table', 'database', 'select', 'insert', 'update',
    'delete', 'join', 'where', 'group by', 'order by', 'schema',
    'column', 'row', 'record', 'data', 'fetch', 'retrieve',
    // SQL error patterns - critical for follow-up detection
    'relation', 'does not exist', 'not found', 'syntax error',
    'permission denied', 'violates', 'constraint', 'duplicate key',
    'null value', 'error', 'failed', 'invalid', 'cannot', 'undefined',
    // Follow-up patterns
    'fix', 'wrong', 'incorrect', 'try again', 'instead', 'modify',
    'change', 'correct', 'adjust'
  ];

  return sqlIndicators.some(indicator => lower.includes(indicator));
}
