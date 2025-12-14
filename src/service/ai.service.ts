import { Sequelize, QueryTypes } from 'sequelize';
import OpenAI from 'openai';
import { sequelize } from '../config/db';
import { decrypt } from '../utils/encryption';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

import { 
  getRecentQueryHistory, 
  getAIGeneratedQueries, 
  formatQueryHistoryForAI 
} from './query-history.service';

// ============================================
// AI SERVICE
// Handles AI-powered SQL generation and query explanation
// ============================================

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

const SQL_GENERATION_SYSTEM_PROMPT = `You are an expert SQL query generator for a PostgreSQL database. 
Your task is to generate optimized SQL queries based on user requests and provide detailed reasoning about your approach.

### Guidelines:
- Use only tables, relationships & columns from the Database Schema JSON
- Ensure all foreign keys are properly joined and maintain referential integrity
- Optimize queries to minimize full-table scans and improve efficiency
- If a required table or relationship is missing, return appropriate error information
- Never make assumptions about missing data or relationships
- Return a JSON response containing both the SQL query and your reasoning process
- Always prefix table names with their schema (e.g., public.users)
- Use proper SQL formatting with line breaks for readability

### Response Format (JSON only, no markdown):
{
  "query": "SELECT ...",
  "reasoning": {
    "steps": ["Step 1", "Step 2", ...],
    "optimization_notes": ["Note 1", "Note 2", ...]
  },
  "tables_used": ["schema.table1", "schema.table2"],
  "columns_used": ["table1.column1", "table2.column2"],
  "desc": "A detailed explanation of what this query does and what data it returns"
}`;

/**
 * Extract relevant metadata based on user query
 */
async function extractRelevantMetadata(
  userQuery: string, 
  fullMetadata: string
): Promise<string> {
  const prompt = `
### Task:
- Extract **only the necessary tables, columns, and relationships** required to answer the user's query.
- Do **not** include unrelated tables or columns.
- If no relevant data exists, return "{}" (empty JSON object).
- Ensure foreign key relations are included.

### Database Metadata:
${fullMetadata}

### User Query:
"${userQuery}"

### Output Format (JSON only):
{
  "metadata": {
    "tables": [
      {
        "schema": "schema_name",
        "name": "table_name",
        "columns": [{"name": "column1", "type": "type1"}]
      }
    ],
    "relationships": [
      { "from": "schema.table.column", "to": "schema.table.column" }
    ]
  }
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a database schema analyzer. Return only JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
  });

  return response.choices[0].message.content || '{}';
}

/**
 * Generate SQL from natural language prompt
 */
export async function generateSqlFromPrompt(
  connectionId: string,
  prompt: string,
  selectedSchemas: string[]
): Promise<GenerateSqlResult> {
  logger.info(`[AI_SERVICE] Generating SQL for: "${prompt.substring(0, 50)}..."`);
  
  // Get database metadata
  const metadata = await generateDbMetadata(connectionId, selectedSchemas);
  const metadataStr = JSON.stringify(metadata);
  
  // Extract relevant parts for the query
  const relevantMetadata = await extractRelevantMetadata(prompt, metadataStr);
  
  // Get query history for context
  const [recentQueries, aiQueries] = await Promise.all([
    getRecentQueryHistory(connectionId, 15),
    getAIGeneratedQueries(connectionId, 10),
  ]);
  
  const queryHistoryContext = formatQueryHistoryForAI(recentQueries, aiQueries);
  
  logger.debug(`[AI_SERVICE] Relevant metadata extracted, query history: ${recentQueries.length} recent, ${aiQueries.length} AI-generated`);
  
  // Generate SQL
  const sqlPrompt = `
### Task:
Generate an optimized PostgreSQL query based on the user's request.

### Database Schema:
${relevantMetadata}
${queryHistoryContext}

### User Request:
"${prompt}"

### Rules:
1. Use only the provided tables and columns
2. Always use schema-qualified table names (e.g., public.users)
3. Properly join tables using foreign keys
4. Return clean, formatted SQL
5. Include a description of what the query returns
6. Learn from the query history patterns if available

Return ONLY a JSON object with the query and reasoning.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SQL_GENERATION_SYSTEM_PROMPT + '\n\nFull Schema:\n' + metadataStr },
      { role: 'user', content: sqlPrompt }
    ],
    temperature: 0.2,
  });

  const aiResponse = response.choices[0].message.content || '';
  
  // Parse and sanitize the response
  return parseAIResponse(aiResponse);
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
    const sqlMatch = aiResponse.match(/SELECT[\s\S]*?;/i);
    
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
  
  const prompt = `
### Task:
Explain what this SQL query does in plain English. Be clear and concise.

### Database Schema Context:
${JSON.stringify(metadata.tables.slice(0, 20))} // Limit context size

### SQL Query:
${sql}

### Instructions:
1. Explain what data this query retrieves or modifies
2. Explain any joins and filtering conditions
3. Note any performance considerations
4. Keep the explanation accessible to non-technical users`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a SQL expert. Explain queries clearly and concisely.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
  });

  return response.choices[0].message.content || 'Unable to generate explanation';
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
