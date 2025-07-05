export type DbTable = {
  table_schema: string,
  table_name: string,
  columns?: DbColumns[] 
}

export type DbColumns = {
  column_name: string,
  data_type: string
}

export type DbMetadata = {
  tables: DbTable[],
  relationships: Relationships[]
}

export type Relationships = {
  table_schema: string,
  table_name: string,
  column_name: string,
  foreign_table_name: string,
  foreign_column_name: string
}

// New interfaces for data API endpoints
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

export interface GetTableDataRequest {
  uri: string;
  tableName: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filterValue?: string;
  columns?: string[];
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

export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: any;
}