// ============================================
// ChatSQL - TypeScript Type Definitions
// ============================================

// ============================================
// USER TYPES
// ============================================
export interface User {
  id: string;
  email: string;
  password_hash: string;
  username: string | null;
  profile_url: string | null;
  role: 'super_admin' | 'viewer';
  is_verified: boolean;
  is_active: boolean;
  is_temporary: boolean;
  expires_at: Date | null;
  must_change_password: boolean;
  created_by_user_id: string | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserPublic {
  id: string;
  email: string;
  username: string | null;
  profile_url: string | null;
  role: 'super_admin' | 'viewer';
  is_verified: boolean;
  is_temporary: boolean;
  expires_at: Date | null;
  must_change_password: boolean;
  created_at: Date;
}

export interface EmailVerification {
  id: string;
  email: string;
  otp_code: string;
  otp_hash: string;
  expires_at: Date;
  is_used: boolean;
  attempts: number;
  max_attempts: number;
  created_at: Date;
}

export interface PasswordReset {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  is_used: boolean;
  created_at: Date;
}

// ============================================
// AUTH TYPES
// ============================================
export interface RegisterRequest {
  email: string;
  password: string;
  username?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface VerifyEmailRequest {
  email: string;
  otp: string;
}

export interface ResendOtpRequest {
  email: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface AuthResponse {
  success: boolean;
  user?: UserPublic;
  message?: string;
}

export interface OtpResponse {
  success: boolean;
  message: string;
  expiresIn?: number; // seconds
}

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// ============================================
// API RESPONSE TYPES
// ============================================
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
}

export interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: PaginationInfo;
}

// ============================================
// CONNECTION TYPES
// ============================================
export interface Connection {
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  type: 'postgres'; // Only PostgreSQL for now
  db_name: string;
  username: string;
  password_enc: string; // Encrypted, never returned to client
  ssl: boolean;
  extra_options?: Record<string, any>;
  is_valid: boolean;
  schema_synced: boolean;
  schema_synced_at: Date | null;
  last_tested_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Connection without sensitive data (for API responses)
export interface ConnectionPublic {
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  type: 'postgres';
  db_name: string;
  username: string;
  ssl: boolean;
  is_valid: boolean;
  schema_synced: boolean;
  schema_synced_at: Date | null;
  last_tested_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Request types for connection APIs
export interface TestConnectionRequest {
  host: string;
  port: number;
  db_name: string;
  username: string;
  password: string;
  ssl?: boolean;
}

export interface CreateConnectionRequest {
  name: string;
  host: string;
  port: number;
  db_name: string;
  username: string;
  password: string;
  ssl?: boolean;
}

export interface UpdateConnectionRequest {
  name?: string;
  host?: string;
  port?: number;
  db_name?: string;
  username?: string;
  password?: string; // Only if changing password
  ssl?: boolean;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  latency_ms?: number;
  schemas?: string[]; // Available PostgreSQL schemas found during test
  error?: string;
  code?: string;
}

// ============================================
// DATABASE SCHEMA TYPES (PostgreSQL schemas like public, analytics, etc.)
// ============================================
export interface DatabaseSchema {
  id: string;
  connection_id: string;
  schema_name: string;
  is_selected: boolean;
  table_count: number;
  description?: string;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DatabaseSchemaPublic {
  id: string;
  schema_name: string;
  is_selected: boolean;
  table_count: number;
  description?: string;
  last_synced_at: Date | null;
}

// Request to update which schemas are selected
export interface UpdateSchemasRequest {
  schemas: Array<{
    schema_name: string;
    is_selected: boolean;
  }>;
}

// ============================================
// TABLE SCHEMA TYPES (Cached table metadata)
// ============================================
export interface TableSchema {
  id: string;
  connection_id: string;
  database_schema_id?: string;
  schema_name: string;
  table_name: string;
  table_type: 'BASE TABLE' | 'VIEW' | 'MATERIALIZED VIEW';
  columns: TableColumnDef[];
  primary_key_columns?: string[];
  indexes?: IndexDef[];
  row_count?: number;
  table_size_bytes?: number;
  description?: string;
  last_fetched_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface TableColumnDef {
  name: string;
  data_type: string;           // e.g., 'varchar(255)', 'integer', 'uuid'
  udt_name: string;            // Underlying type name (e.g., 'int4', 'varchar')
  is_nullable: boolean;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  foreign_key_ref?: {
    table: string;
    column: string;
    schema: string;
  };
  default_value?: string;
  max_length?: number;
  numeric_precision?: number;
  column_comment?: string;
}

export interface IndexDef {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  type: string; // btree, hash, gin, gist, etc.
}

// ============================================
// TABLE & SCHEMA TYPES (for API responses)
// ============================================
export interface TableInfo {
  id: string;
  name: string;
  schema_name: string; // PostgreSQL schema (public, analytics, etc.)
  description?: string;
  rowCount?: number;
  table_type: 'BASE TABLE' | 'VIEW' | 'MATERIALIZED VIEW';
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'json' | 'array';
  dataType: string;           // Original PostgreSQL type
  sortable: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  foreignKeyRef?: {
    schema: string;
    table: string;
    column: string;
  };
  isNullable?: boolean;
  defaultValue?: string;
}

// Schema-grouped response for sidebar
export interface SchemaWithTables {
  schema_name: string;
  is_selected: boolean;
  table_count: number;
  tables: TableInfo[];
}

// ============================================
// ERD RELATION TYPES (Foreign Key Relationships)
// ============================================
export interface ERDRelation {
  id: string;
  connection_id: string;
  source_schema: string;
  source_table: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
  constraint_name?: string;
  relation_type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  created_at: Date;
}

export interface GetSchemasResponse {
  success: boolean;
  schemas: DatabaseSchemaPublic[];
  total_schemas: number;
  cached?: boolean;
  cachedAt?: Date;
  error?: string;
}

// ============================================
// QUERY TYPES
// ============================================
export interface Query {
  id: string;
  user_id: string;
  connection_id: string;
  query_text: string;
  raw_result?: any;
  row_count?: number;
  execution_time?: number;
  status: 'success' | 'error';
  error_message?: string;
  is_saved: boolean;
  saved_name?: string;
  created_at: Date;
}

// ============================================
// TABLE DATA TYPES
// ============================================
export interface GetTableDataRequest {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: FilterCondition[];
  searchValue?: string;
  columns?: string[];
  schema_name?: string; // Filter by PostgreSQL schema
}

export interface FilterCondition {
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'is_null' | 'is_not_null';
  value: any;
}

export interface GetTableDataResponse {
  success: boolean;
  data: Record<string, any>[];
  pagination: PaginationInfo;
  columns: ColumnInfo[];
  schema_name?: string;
  table_name?: string;
  error?: string;
}

export interface GetTablesResponse {
  success: boolean;
  schemas: SchemaWithTables[]; // Tables grouped by schema
  totalSchemas: number;
  totalTables: number;
  cached?: boolean;
  cachedAt?: Date;
  error?: string;
}

// ============================================
// DASHBOARD TYPES (Future)
// ============================================
export interface Dashboard {
  id: string;
  user_id: string;
  connection_id: string;
  name: string;
  layout_config?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface DashboardWidget {
  id: string;
  dashboard_id: string;
  type: 'chart' | 'table' | 'counter' | 'kpi' | 'custom-sql';
  sql_query: string;
  config_json?: WidgetConfig;
  refresh_interval?: number;
  created_at: Date;
}

export interface WidgetConfig {
  title: string;
  chartType?: 'bar' | 'line' | 'pie' | 'area' | 'scatter';
  xAxis?: string;
  yAxis?: string;
  colors?: string[];
}

// ============================================
// ERD TYPES (Future)
// ============================================
export interface ERDRelation {
  id: string;
  connection_id: string;
  table_from: string;
  table_to: string;
  column_from: string;
  column_to: string;
  relation_type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  created_at: Date;
}

export interface ERDResponse {
  success: boolean;
  tables: { name: string; columns: ColumnInfo[] }[];
  relationships: ERDRelation[];
}

// ============================================
// AI TYPES (Future)
// ============================================
export interface AIQueryLog {
  id: string;
  user_id: string;
  connection_id: string;
  prompt_text: string;
  generated_query?: string;
  created_at: Date;
}

export interface AIGenerateRequest {
  prompt: string;
  context?: {
    tables?: string[];
    previousQuery?: string;
  };
}

export interface AIGenerateResponse {
  success: boolean;
  query: string;
  explanation: string;
  confidence: number;
  logId: string;
}
