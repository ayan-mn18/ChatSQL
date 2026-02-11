// ============================================
// SCHEMA CONTEXT SERVICE
// Fetches and caches database schema for AI context
// ============================================

import { Sequelize, QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { decrypt } from '../utils/encryption';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

const SCHEMA_CONTEXT_TTL = 3600; // 1 hour

interface TableInfo {
  schema: string;
  name: string;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
}

interface RelationshipInfo {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface SchemaContext {
  tables: TableInfo[];
  relationships: RelationshipInfo[];
  summary: string; // Human-readable summary for AI
}

/**
 * Get schema context for AI from cache or database
 */
export async function getSchemaContext(
  connectionId: string,
  selectedSchemas: string[] = ['public']
): Promise<SchemaContext> {
  const redis = getRedisClient();
  const schemasKey = selectedSchemas.sort().join(',') || 'public';
  const cacheKey = `schema_context:${connectionId}:${schemasKey}`;

  // Check cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug(`[SCHEMA_CTX] Using cached context for ${connectionId}`);
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn('[SCHEMA_CTX] Cache read failed');
  }

  // Fetch fresh from database
  logger.info(`[SCHEMA_CTX] Fetching fresh context for ${connectionId}`);
  const context = await fetchSchemaFromDatabase(connectionId, selectedSchemas);

  // Cache it
  try {
    await redis.setex(cacheKey, SCHEMA_CONTEXT_TTL, JSON.stringify(context));
  } catch (err) {
    logger.warn('[SCHEMA_CTX] Cache write failed');
  }

  return context;
}

/**
 * Get schema context as a formatted string for AI prompts
 */
export async function getSchemaContextString(
  connectionId: string,
  selectedSchemas: string[] = ['public']
): Promise<string> {
  const context = await getSchemaContext(connectionId, selectedSchemas);
  return context.summary;
}

/**
 * Fetch schema information from user's database
 */
async function fetchSchemaFromDatabase(
  connectionId: string,
  selectedSchemas: string[]
): Promise<SchemaContext> {
  // Get connection details (individual columns, not a connection string)
  const [connection] = await sequelize.query<{
    host: string;
    port: number;
    db_name: string;
    username: string;
    password_enc: string;
    ssl: boolean;
  }>(
    `SELECT host, port, db_name, username, password_enc, ssl 
     FROM connections WHERE id = :connectionId`,
    { replacements: { connectionId }, type: QueryTypes.SELECT }
  );

  if (!connection) {
    throw new Error('Connection not found');
  }

  // Decrypt password and connect to user's database
  const password = decrypt(connection.password_enc);
  const userDB = new Sequelize({
    dialect: 'postgres',
    host: connection.host,
    port: connection.port,
    database: connection.db_name,
    username: connection.username,
    password,
    logging: false,
    dialectOptions: connection.ssl ? {
      ssl: { require: true, rejectUnauthorized: false },
    } : {},
    pool: {
      max: 2,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  });

  try {
    await userDB.authenticate();

    // Fetch tables
    const tables = await fetchTables(userDB, selectedSchemas);
    
    // Fetch relationships
    const relationships = await fetchRelationships(userDB, selectedSchemas);
    
    // Generate summary
    const summary = generateSchemaSummary(tables, relationships);

    return { tables, relationships, summary };
  } finally {
    await userDB.close();
  }
}

/**
 * Fetch table and column information
 */
async function fetchTables(
  db: Sequelize,
  schemas: string[]
): Promise<TableInfo[]> {
  const schemaList = schemas.map(s => `'${s}'`).join(',');

  const columns = await db.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT 
      c.table_schema,
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t 
      ON c.table_schema = t.table_schema 
      AND c.table_name = t.table_name
    WHERE c.table_schema IN (${schemaList})
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    { type: QueryTypes.SELECT }
  );

  // Group by table
  const tableMap = new Map<string, TableInfo>();
  
  for (const col of columns) {
    const key = `${col.table_schema}.${col.table_name}`;
    
    if (!tableMap.has(key)) {
      tableMap.set(key, {
        schema: col.table_schema,
        name: col.table_name,
        columns: [],
      });
    }
    
    tableMap.get(key)!.columns.push({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === 'YES',
    });
  }

  return Array.from(tableMap.values());
}

/**
 * Fetch foreign key relationships
 */
async function fetchRelationships(
  db: Sequelize,
  schemas: string[]
): Promise<RelationshipInfo[]> {
  const schemaList = schemas.map(s => `'${s}'`).join(',');

  const relationships = await db.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    foreign_table_schema: string;
    foreign_table_name: string;
    foreign_column_name: string;
  }>(
    `SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name,
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema IN (${schemaList})`,
    { type: QueryTypes.SELECT }
  );

  return relationships.map(r => ({
    fromTable: `${r.table_schema}.${r.table_name}`,
    fromColumn: r.column_name,
    toTable: `${r.foreign_table_schema}.${r.foreign_table_name}`,
    toColumn: r.foreign_column_name,
  }));
}

/**
 * Generate human-readable schema summary for AI
 */
function generateSchemaSummary(
  tables: TableInfo[],
  relationships: RelationshipInfo[]
): string {
  const lines: string[] = [];
  
  lines.push(`Database has ${tables.length} tables:\n`);

  for (const table of tables) {
    const tableName = `${table.schema}.${table.name}`;
    const columnList = table.columns
      .map(c => `${c.name} (${c.type})`)
      .join(', ');
    
    lines.push(`• ${tableName}: ${columnList}`);
  }

  if (relationships.length > 0) {
    lines.push('\nRelationships:');
    for (const rel of relationships) {
      lines.push(`• ${rel.fromTable}.${rel.fromColumn} → ${rel.toTable}.${rel.toColumn}`);
    }
  }

  return lines.join('\n');
}

/**
 * Invalidate schema cache for a connection
 */
export async function invalidateSchemaCache(connectionId: string): Promise<void> {
  const redis = getRedisClient();
  const pattern = `schema_context:${connectionId}:*`;
  
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info(`[SCHEMA_CTX] Invalidated ${keys.length} cached contexts for ${connectionId}`);
    }
  } catch (err) {
    logger.warn('[SCHEMA_CTX] Failed to invalidate cache');
  }
}
