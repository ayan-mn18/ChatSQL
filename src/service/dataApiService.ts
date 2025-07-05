import { Sequelize, QueryTypes } from 'sequelize';

// Type mappings for database types to frontend types
const typeMapping: { [key: string]: 'string' | 'number' | 'date' | 'boolean' } = {
  // Numbers
  'integer': 'number',
  'int': 'number',
  'int2': 'number',
  'int4': 'number',
  'int8': 'number',
  'smallint': 'number',
  'bigint': 'number',
  'decimal': 'number',
  'numeric': 'number',
  'real': 'number',
  'double precision': 'number',
  'double': 'number',
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
  'bit': 'boolean'
};

// Interface definitions
export interface ColumnInfo {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  dataType: string;
  sortable: boolean;
  isPrimaryKey?: boolean;
  isNullable?: boolean;
}

export interface TableInfo {
  id: string;
  name: string;
  description: string;
  rowCount: number;
  schema?: string;
  columns: ColumnInfo[];
}

export interface GetTablesResponse {
  success: boolean;
  tables: TableInfo[];
  totalTables: number;
  error: string | null;
}

export interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface GetTableDataResponse {
  success: boolean;
  data: Record<string, any>[];
  pagination: PaginationInfo;
  columns: ColumnInfo[];
  error: string | null;
}

// Helper function to map database types to frontend types
const getColumnType = (dataType: string): 'string' | 'number' | 'date' | 'boolean' => {
  const normalizedType = dataType.toLowerCase().trim();
  
  for (const [dbType, frontendType] of Object.entries(typeMapping)) {
    if (normalizedType.includes(dbType.toLowerCase())) {
      return frontendType;
    }
  }
  
  return 'string'; // Default to string if no match
};

// Helper function to validate and sanitize table/column names
const sanitizeName = (name: string): string => {
  // Remove any potential SQL injection characters and validate
  return name.replace(/[^a-zA-Z0-9_]/g, '');
};

export const getTables = async (uri: string): Promise<{ tables: TableInfo[]; totalTables: number }> => {
  const sequelize = new Sequelize(uri, { 
    logging: false,
    dialectOptions: {
      connectTimeout: 60000,
    },
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });

  try {
    // Test connection
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

    const tablesResult = await sequelize.query(tablesQuery, { 
      type: QueryTypes.SELECT 
    }) as any[];

    // Get columns for each table
    const tableInfoPromises = tablesResult.map(async (table) => {
      const columnsQuery = `
        SELECT 
          c.column_name as key,
          c.column_name as label,
          c.data_type as data_type,
          c.udt_name as udt_name,
          CASE WHEN c.is_nullable = 'YES' THEN true ELSE false END as is_nullable,
          CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
          c.ordinal_position
        FROM information_schema.columns c
        LEFT JOIN information_schema.key_column_usage kcu 
          ON c.table_schema = kcu.table_schema 
          AND c.table_name = kcu.table_name 
          AND c.column_name = kcu.column_name
        LEFT JOIN information_schema.table_constraints tc 
          ON kcu.constraint_name = tc.constraint_name 
          AND tc.constraint_type = 'PRIMARY KEY'
        WHERE c.table_name = :tableName 
          AND c.table_schema = :schemaName
        ORDER BY c.ordinal_position;
      `;

      const columns = await sequelize.query(columnsQuery, {
        replacements: { 
          tableName: table.name, 
          schemaName: table.schema 
        },
        type: QueryTypes.SELECT 
      }) as any[];

      const mappedColumns: ColumnInfo[] = columns.map(col => ({
        key: col.key,
        label: col.label,
        type: getColumnType(col.udt_name || col.data_type),
        dataType: col.udt_name || col.data_type,
        sortable: true,
        isPrimaryKey: col.is_primary_key || false,
        isNullable: col.is_nullable || false,
      }));

      return {
        id: table.name,
        name: table.name,
        description: table.description || '',
        rowCount: parseInt(table.row_count, 10) || 0,
        schema: table.schema,
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
  const sequelize = new Sequelize(uri, { 
    logging: false,
    dialectOptions: {
      connectTimeout: 60000,
    },
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });

  try {
    await sequelize.authenticate();

    // Validate and sanitize table name
    const sanitizedTableName = sanitizeName(tableName);
    if (!sanitizedTableName) {
      throw new Error('Invalid table name');
    }

    // Get table schema information
    const schemaQuery = `
      SELECT 
        column_name,
        data_type,
        udt_name,
        is_nullable,
        ordinal_position
      FROM information_schema.columns 
      WHERE table_name = :tableName 
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY ordinal_position;
    `;

    const schemaResult = await sequelize.query(schemaQuery, {
      replacements: { tableName: sanitizedTableName },
      type: QueryTypes.SELECT 
    }) as any[];

    if (schemaResult.length === 0) {
      throw new Error(`Table '${tableName}' not found`);
    }

    const allColumnNames = schemaResult.map(col => col.column_name);
    
    // Validate sortBy column if provided
    if (sortBy && !allColumnNames.includes(sortBy)) {
      throw new Error(`Column '${sortBy}' not found in table '${tableName}'`);
    }

    // Validate columnsToFetch if provided
    if (columnsToFetch && columnsToFetch.length > 0) {
      const invalidColumns = columnsToFetch.filter(col => !allColumnNames.includes(col));
      if (invalidColumns.length > 0) {
        throw new Error(`Invalid columns: ${invalidColumns.join(', ')}`);
      }
    }

    const limit = Math.min(Math.max(pageSize, 1), 100); // Ensure pageSize is between 1 and 100
    const offset = Math.max((page - 1) * limit, 0);

    // Build WHERE clause for filtering
    let whereClause = '';
    const replacements: any = { limit, offset, tableName: sanitizedTableName };

    if (filterValue && filterValue.trim()) {
      const filterConditions = allColumnNames
        .map(col => `CAST("${col}" AS TEXT) ILIKE :filterValue`)
        .join(' OR ');
      whereClause = `WHERE ${filterConditions}`;
      replacements.filterValue = `%${filterValue.trim()}%`;
    }

    // Build ORDER BY clause
    let orderClause = '';
    if (sortBy && allColumnNames.includes(sortBy)) {
      const sanitizedSortBy = sanitizeName(sortBy);
      const sanitizedSortOrder = sortOrder === 'desc' ? 'DESC' : 'ASC';
      orderClause = `ORDER BY "${sanitizedSortBy}" ${sanitizedSortOrder}`;
    }

    // Build SELECT columns
    const selectColumns = columnsToFetch && columnsToFetch.length > 0 
      ? columnsToFetch.map(col => `"${sanitizeName(col)}"`).join(', ')
      : '*';

    // Execute data query
    const dataQuery = `
      SELECT ${selectColumns} 
      FROM "${sanitizedTableName}" 
      ${whereClause} 
      ${orderClause} 
      LIMIT :limit OFFSET :offset;
    `;

    // Execute count query
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM "${sanitizedTableName}" 
      ${whereClause};
    `;

    const [data, totalResult] = await Promise.all([
      sequelize.query(dataQuery, { 
        replacements, 
        type: QueryTypes.SELECT 
      }),
      sequelize.query(countQuery, { 
        replacements: { 
          ...replacements, 
          limit: undefined, 
          offset: undefined 
        }, 
        type: QueryTypes.SELECT 
      })
    ]);

    const totalRecords = parseInt((totalResult[0] as any).total, 10);
    const totalPages = Math.ceil(totalRecords / limit);

    // Map columns with type information
    const columns: ColumnInfo[] = schemaResult.map(col => ({
      key: col.column_name,
      label: col.column_name,
      type: getColumnType(col.udt_name || col.data_type),
      dataType: col.udt_name || col.data_type,
      sortable: true,
      isNullable: col.is_nullable === 'YES',
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
