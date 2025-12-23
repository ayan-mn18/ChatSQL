import { Sequelize, QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { decrypt } from '../utils/encryption';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { generateGeminiText } from './gemini.client';
import {
  buildExplainSqlPrompt,
  buildExtractRelevantMetadataPrompt,
  buildSqlGenerationPrompt,
} from './ai.prompts';

import type { ChatMessage } from '../services/chat.service';

import { 
  getRecentQueryHistory, 
  getAIGeneratedQueries, 
  formatQueryHistoryForAI 
} from './query-history.service';

// ============================================
// AI SERVICE
// Handles AI-powered SQL generation and query explanation
// Using Google Gemini (model configurable)
// ============================================

// Cache TTL for AI context (1 hour)
const AI_CONTEXT_TTL = 3600;

// ============================================
// TYPES
// ============================================

interface DbMetadata {
  tables: TableMetadata[];
  relationships: RelationshipMetadata[];
}

interface TableMetadata {
  table_schema: string;
  table_name: string;
  columns: ColumnMetadata[];
}

interface ColumnMetadata {
  column_name: string;
  data_type: string;
}

interface RelationshipMetadata {
  table_schema: string;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

export interface GenerateSqlResult {
  query: string;
  reasoning: {
    steps: string[];
    optimization_notes: string[];
  };
  tables_used: string[];
  columns_used: string[];
  desc: string;
}

// ============================================
// DATABASE METADATA GENERATION
// ============================================

/**
 * Create a temporary connection to user's database
 */
async function createUserDBConnection(connectionId: string): Promise<Sequelize | null> {
  try {
    const [connectionRow] = await sequelize.query<any>(
      `SELECT host, port, db_name, username, password_enc, ssl 
       FROM connections WHERE id = :connectionId`,
      {
        replacements: { connectionId },
        type: QueryTypes.SELECT,
      }
    );
    
    if (!connectionRow) {
      logger.error(`[AI_SERVICE] Connection not found: ${connectionId}`);
      return null;
    }
    
    const password = decrypt(connectionRow.password_enc);
    
    const userDB = new Sequelize({
      dialect: 'postgres',
      host: connectionRow.host,
      port: connectionRow.port,
      database: connectionRow.db_name,
      username: connectionRow.username,
      password,
      ssl: connectionRow.ssl,
      dialectOptions: connectionRow.ssl ? {
        ssl: { require: true, rejectUnauthorized: false }
      } : {},
      logging: false,
      pool: {
        max: 2,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
    });
    
    await userDB.authenticate();
    return userDB;
  } catch (error: any) {
    logger.error(`[AI_SERVICE] Failed to create user DB connection: ${error.message}`);
    return null;
  }
}

/**
 * Get tables and their columns for specified schemas
 */
async function getTablesAndSchemas(
  userDB: Sequelize, 
  selectedSchemas: string[]
): Promise<TableMetadata[]> {
  // Build schema filter
  const schemaFilter = selectedSchemas.length > 0
    ? `AND table_schema IN (${selectedSchemas.map(s => `'${s}'`).join(', ')})`
    : `AND table_schema NOT IN ('pg_catalog', 'information_schema')`;

  const query = `
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_type = 'BASE TABLE'
    ${schemaFilter}
    ORDER BY table_schema, table_name;
  `;

  const [tables] = await userDB.query(query) as [TableMetadata[], unknown];
  
  // Get columns for each table
  for (const table of tables) {
    const colQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = '${table.table_name}' 
      AND table_schema = '${table.table_schema}'
      ORDER BY ordinal_position;
    `;
    const [columns] = await userDB.query(colQuery);
    table.columns = columns as ColumnMetadata[];
  }

  return tables;
}

/**
 * Get foreign key relationships
 */
async function getTableRelationships(
  userDB: Sequelize,
  selectedSchemas: string[]
): Promise<RelationshipMetadata[]> {
  const schemaFilter = selectedSchemas.length > 0
    ? `AND kcu.table_schema IN (${selectedSchemas.map(s => `'${s}'`).join(', ')})`
    : `AND kcu.table_schema NOT IN ('pg_catalog', 'information_schema')`;

  const query = `
    SELECT 
      kcu.table_schema,
      kcu.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.constraint_column_usage ccu 
      ON kcu.constraint_name = ccu.constraint_name
      AND kcu.table_schema = ccu.table_schema
    JOIN information_schema.table_constraints tc
      ON kcu.constraint_name = tc.constraint_name
      AND tc.constraint_type = 'FOREIGN KEY'
    WHERE 1=1 ${schemaFilter}
    ORDER BY kcu.table_schema, kcu.table_name;
  `;

  const [relationships] = await userDB.query(query);
  return relationships as RelationshipMetadata[];
}

/**
 * Generate database metadata for AI context
 */
async function generateDbMetadata(
  connectionId: string,
  selectedSchemas: string[]
): Promise<DbMetadata> {
  // Check cache first
  const redis = getRedisClient();
  const cacheKey = `ai_context:${connectionId}:${selectedSchemas.sort().join(',')}`;
  
  const cached = await redis.get(cacheKey);
  if (cached) {
    logger.debug(`[AI_SERVICE] Using cached metadata for connection: ${connectionId}`);
    return JSON.parse(cached);
  }

  logger.info(`[AI_SERVICE] Generating metadata for connection: ${connectionId}`);
  
  const userDB = await createUserDBConnection(connectionId);
  if (!userDB) {
    throw new Error('Failed to connect to database');
  }

  try {
    const tables = await getTablesAndSchemas(userDB, selectedSchemas);
    const relationships = await getTableRelationships(userDB, selectedSchemas);
    
    const metadata: DbMetadata = { tables, relationships };
    
    // Cache the metadata
    await redis.setex(cacheKey, AI_CONTEXT_TTL, JSON.stringify(metadata));
    
    return metadata;
  } finally {
    await userDB.close();
  }
}

// ============================================
// AI SQL GENERATION
// ============================================

/**
 * Extract relevant metadata based on user query
 */
async function extractRelevantMetadata(
  userQuery: string, 
  fullMetadata: string,
  conversationContext?: string
): Promise<string> {
  const prompt = buildExtractRelevantMetadataPrompt({
    userQuery,
    fullMetadata,
    conversationContext,
  });

  const text = await generateGeminiText({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
    },
  });

  return text || '{}';
}

function formatChatHistoryForSqlGeneration(
  chatHistory: ChatMessage[] | undefined,
  latestUserRequest: string
): string {
  if (!chatHistory || chatHistory.length === 0) return '';

  const MAX_MESSAGES = 12;
  const MAX_CHARS_PER_MESSAGE = 700;

  const recent = chatHistory.slice(-MAX_MESSAGES);

  // If the latest message duplicates the current request, omit it to avoid repetition.
  const withoutDuplicateCurrent = (() => {
    const last = recent[recent.length - 1];
    if (last?.role === 'user' && last.content?.trim() === latestUserRequest.trim()) {
      return recent.slice(0, -1);
    }
    return recent;
  })();

  if (withoutDuplicateCurrent.length === 0) return '';

  const lines: string[] = [];
  lines.push('### Chat history (oldest → newest):');

  for (const msg of withoutDuplicateCurrent) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    const normalized = (msg.content || '').replace(/\s+/g, ' ').trim();
    const clipped = normalized.length > MAX_CHARS_PER_MESSAGE
      ? `${normalized.slice(0, MAX_CHARS_PER_MESSAGE)}...`
      : normalized;

    lines.push(`${roleLabel}: ${clipped}`);

    if (msg.role === 'assistant' && msg.sqlGenerated) {
      const sql = msg.sqlGenerated.replace(/\s+/g, ' ').trim();
      const sqlClipped = sql.length > 400 ? `${sql.slice(0, 400)}...` : sql;
      lines.push(`(assistant previously generated SQL): ${sqlClipped}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate SQL from natural language prompt
 */
export async function generateSqlFromPrompt(
  connectionId: string,
  prompt: string,
  selectedSchemas: string[],
  options?: {
    chatHistory?: ChatMessage[];
  }
): Promise<GenerateSqlResult> {
  logger.info(`[AI_SERVICE] Generating SQL for: "${prompt.substring(0, 50)}..."`);
  
  // Get database metadata
  const metadata = await generateDbMetadata(connectionId, selectedSchemas);
  const metadataStr = JSON.stringify(metadata);

  // Chat history context (very important for intent/constraints)
  const conversationContext = formatChatHistoryForSqlGeneration(options?.chatHistory, prompt);
  
  // Extract relevant parts for the query
  const relevantMetadata = await extractRelevantMetadata(prompt, metadataStr, conversationContext);
  
  // Get query history for context
  const [recentQueries, aiQueries] = await Promise.all([
    getRecentQueryHistory(connectionId, 15),
    getAIGeneratedQueries(connectionId, 10),
  ]);
  
  const queryHistoryContext = formatQueryHistoryForAI(recentQueries, aiQueries);
  
  logger.debug(`[AI_SERVICE] Relevant metadata extracted, query history: ${recentQueries.length} recent, ${aiQueries.length} AI-generated`);
  
  // Generate SQL
  const sqlPrompt = buildSqlGenerationPrompt({
    fullSchemaJson: metadataStr,
    relevantSchemaJson: relevantMetadata,
    queryHistoryContext,
    conversationContext,
    userRequest: prompt,
  });

  const aiResponse = await generateGeminiText({
    contents: [{ role: 'user', parts: [{ text: sqlPrompt }] }],
    generationConfig: {
      temperature: 0.1,
    },
  });
  
  // Parse and sanitize the response
  return parseAIResponse(aiResponse || '');
}

/**
 * Parse and sanitize AI response
 */
function parseAIResponse(aiResponse: string): GenerateSqlResult {
  try {
    // Remove markdown code blocks if present
    const cleaned = aiResponse
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    
    return {
      query: parsed.query || '',
      reasoning: {
        steps: parsed.reasoning?.steps || [],
        optimization_notes: parsed.reasoning?.optimization_notes || [],
      },
      tables_used: parsed.tables_used || [],
      columns_used: parsed.columns_used || [],
      desc: parsed.desc || 'Query generated successfully',
    };
  } catch (error) {
    logger.error('[AI_SERVICE] Failed to parse AI response:', error);
    
    // Try to extract SQL from raw response
    const sqlMatch = aiResponse.match(/(?:WITH|SELECT|INSERT|UPDATE|DELETE)[\s\S]*?;/i);
    
    return {
      query: sqlMatch ? sqlMatch[0] : '',
      reasoning: {
        steps: ['Failed to parse AI response'],
        optimization_notes: [],
      },
      tables_used: [],
      columns_used: [],
      desc: 'Query generated with parsing errors',
    };
  }
}

// ============================================
// SQL EXPLANATION
// ============================================

/**
 * Explain what a SQL query does in plain English
 */
export async function explainSqlQuery(
  connectionId: string,
  sql: string
): Promise<string> {
  logger.info(`[AI_SERVICE] Explaining SQL query`);
  
  // Get schema context for better explanation
  const metadata = await generateDbMetadata(connectionId, []);
  
  const prompt = buildExplainSqlPrompt({
    schemaContextJson: JSON.stringify(metadata.tables.slice(0, 20)),
    sql,
  });

  const text = await generateGeminiText({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
    },
  });

  return text || 'Unable to generate explanation';
}

/**
 * Invalidate AI context cache for a connection
 */
export async function invalidateAIContextCache(connectionId: string): Promise<void> {
  const redis = getRedisClient();
  const pattern = `ai_context:${connectionId}:*`;
  const keys = await redis.keys(pattern);
  
  if (keys.length > 0) {
    await redis.del(...keys);
    logger.info(`[AI_SERVICE] Invalidated ${keys.length} AI context cache keys`);
  }
}
