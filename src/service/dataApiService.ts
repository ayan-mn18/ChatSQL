import { Sequelize, QueryTypes } from 'sequelize';
import { TableInfo, ColumnInfo, PaginationInfo } from '../types';

// Type mapping from database types to frontend types
const typeMapping: Record<string, 'string' | 'number' | 'date' | 'boolean'> = {
  // Numbers
  'integer': 'number',
  'int': 'number',
  'int4': 'number',
  'int8': 'number',
  'smallint': 'number',
  'bigint': 'number',
  'decimal': 'number',
  'numeric': 'number',
  'real': 'number',
  'double precision': 'number',
  'float': 'number',
  'float4': 'number',
  'float8': 'number',
  'money': 'number',
  'serial': 'number',
  'bigserial': 'number',

  // Strings
  'character varying': 'string',
  'varchar': 'string',
  'text': 'string',
  'char': 'string',
  'character': 'string',
  'uuid': 'string',
  'json': 'string',
  'jsonb': 'string',
  'xml': 'string',
  'citext': 'string',

  // Dates
  'timestamp': 'date',
  'timestamp with time zone': 'date',
  'timestamp without time zone': 'date',
  'timestamptz': 'date',
  'date': 'date',
  'time': 'date',
  'time with time zone': 'date',
  'time without time zone': 'date',
  'timetz': 'date',
  'interval': 'date',

  // Booleans
  'boolean': 'boolean',
  'bool': 'boolean',
};

/**
 * Map database type to frontend type
 */
const getColumnType = (dataType: string): 'string' | 'number' | 'date' | 'boolean' => {
  const normalizedType = dataType.toLowerCase();
  
  for (const [dbType, frontendType] of Object.entries(typeMapping)) {
    if (normalizedType.includes(dbType)) {
      return frontendType;
    }
  }
  
  return 'string'; // Default to string
};

/**
 * Validate table/column name to prevent SQL injection
 */
const isValidIdentifier = (name: string): boolean => {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
};

/**
 * Get all tables with metadata from a PostgreSQL database
 */
export const getTables = async (uri: string): Promise<{ tables: TableInfo[]; totalTables: number }> => {
  const sequelize = new Sequelize(uri, { 
    logging: false,
    dialectOptions: {
      connectTimeout: 60000
    }
  });

  try {
    await sequelize.authenticate();

    // Get all tables with metadata from public schema only
    const tablesQuery = `
      SELECT 
        t.table_name as name,
        t.table_schema as schema,
        COALESCE(obj_description(c.oid, 'pg_class'), '') as description,
        COALESCE(c.reltuples::bigint, 0) as row_count
      FROM information_schema.tables t
      LEFT JOIN pg_catalog.pg_class c ON c.relname = t.table_name
      LEFT JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name;
    `;

    const tablesResult = await sequelize.query<{
      name: string;
      schema: string;
      description: string;
      row_count: string;
    }>(tablesQuery, { type: QueryTypes.SELECT });

    // Get columns for each table
    const tableInfoPromises = tablesResult.map(async (table) => {
      const columnsQuery = `
        SELECT 
          c.column_name as key,
          c.column_name as label,
          c.data_type as "dataType",
          c.is_nullable = 'YES' as "isNullable",
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as "isPrimaryKey"
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.column_name, kcu.table_name, kcu.table_schema
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.table_constraints tc 
            ON kcu.constraint_name = tc.constraint_name 
            AND kcu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.table_name = pk.table_name 
          AND c.table_schema = pk.table_schema 
          AND c.column_name = pk.column_name
        WHERE c.table_name = :tableName 
          AND c.table_schema = 'public'
        ORDER BY c.ordinal_position;
      `;

      const columns = await sequelize.query<{
        key: string;
        label: string;
        dataType: string;
        isNullable: boolean;
        isPrimaryKey: boolean;
      }>(columnsQuery, {
        replacements: { tableName: table.name },
        type: QueryTypes.SELECT
      });

      const mappedColumns: ColumnInfo[] = columns.map(col => ({
        key: col.key,
        label: col.label,
        type: getColumnType(col.dataType),
        dataType: col.dataType,
        sortable: true,
        isPrimaryKey: col.isPrimaryKey,
        isNullable: col.isNullable
      }));

      return {
        id: table.name,
        name: table.name,
        schema_name: table.schema || 'public',
        description: table.description || '',
        rowCount: parseInt(table.row_count, 10) || 0,
        table_type: 'BASE TABLE' as const,
        columns: mappedColumns,
      } as TableInfo;
    });

    const tables = await Promise.all(tableInfoPromises);

    return {
      tables,
      totalTables: tables.length,
    };
  } finally {
    await sequelize.close();
  }
};

/**
 * Get paginated data from a table
 */
export const getTableData = async (
  uri: string,
  tableName: string,
  page: number = 1,
  pageSize: number = 10,
  sortBy?: string,
  sortOrder: 'asc' | 'desc' = 'asc',
  filterValue?: string,
  columnsToFetch?: string[]
): Promise<{
  data: Record<string, any>[];
  pagination: PaginationInfo;
  columns: ColumnInfo[];
}> => {
  // Validate table name
  if (!isValidIdentifier(tableName)) {
    throw new Error('Invalid table name');
  }

  const sequelize = new Sequelize(uri, { 
    logging: false,
    dialectOptions: {
      connectTimeout: 60000
    }
  });

  try {
    await sequelize.authenticate();

    // Get column info for the table
    const columnsQuery = `
      SELECT 
        column_name as key,
        column_name as label,
        data_type as "dataType",
        is_nullable = 'YES' as "isNullable"
      FROM information_schema.columns 
      WHERE table_name = :tableName 
        AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;

    const allColumns = await sequelize.query<{
      key: string;
      label: string;
      dataType: string;
      isNullable: boolean;
    }>(columnsQuery, {
      replacements: { tableName },
      type: QueryTypes.SELECT
    });

    if (allColumns.length === 0) {
      throw new Error(`Table '${tableName}' not found`);
    }

    const columnNames = allColumns.map(c => c.key);

    // Validate columns to fetch
    if (columnsToFetch && columnsToFetch.length > 0) {
      const invalidColumns = columnsToFetch.filter(c => !columnNames.includes(c));
      if (invalidColumns.length > 0) {
        throw new Error(`Invalid columns: ${invalidColumns.join(', ')}`);
      }
    }

    // Validate sort column
    if (sortBy && !columnNames.includes(sortBy)) {
      throw new Error(`Invalid sort column: ${sortBy}`);
    }

    const limit = Math.min(pageSize, 100);
    const offset = (page - 1) * limit;

    // Build query parts
    const selectColumns = columnsToFetch && columnsToFetch.length > 0 
      ? columnsToFetch.map(c => `"${c}"`).join(', ') 
      : '*';

    let whereClause = '';
    const replacements: Record<string, any> = { limit, offset };

    if (filterValue) {
      const filterConditions = columnNames
        .map((col, idx) => `CAST("${col}" AS TEXT) ILIKE :filterValue`)
        .join(' OR ');
      whereClause = `WHERE ${filterConditions}`;
      replacements.filterValue = `%${filterValue}%`;
    }

    const orderClause = sortBy 
      ? `ORDER BY "${sortBy}" ${sortOrder.toUpperCase()}` 
      : '';

    // Get data
    const dataQuery = `
      SELECT ${selectColumns} 
      FROM "${tableName}" 
      ${whereClause} 
      ${orderClause} 
      LIMIT :limit OFFSET :offset;
    `;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count 
      FROM "${tableName}" 
      ${whereClause};
    `;

    const [data, countResult] = await Promise.all([
      sequelize.query(dataQuery, { 
        replacements, 
        type: QueryTypes.SELECT 
      }),
      sequelize.query<{ count: string }>(countQuery, { 
        replacements, 
        type: QueryTypes.SELECT 
      })
    ]);

    const totalRecords = parseInt(countResult[0].count, 10);
    const totalPages = Math.ceil(totalRecords / limit);

    const columns: ColumnInfo[] = allColumns.map(col => ({
      key: col.key,
      label: col.label,
      type: getColumnType(col.dataType),
      dataType: col.dataType,
      sortable: true,
      isNullable: col.isNullable
    }));

    return {
      data: data as Record<string, any>[],
      pagination: {
        currentPage: page,
        pageSize: limit,
        totalRecords,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      columns,
    };
  } finally {
    await sequelize.close();
  }
};
