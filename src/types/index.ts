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
  is_verified: boolean;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserPublic {
  id: string;
  email: string;
  username: string | null;
  profile_url: string | null;
  is_verified: boolean;
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
// CONNECTION TYPES (Future)
// ============================================
export interface Connection {
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  type: 'postgres' | 'mysql' | 'mssql' | 'mongodb';
  db_name: string;
  username: string;
  password_enc: string;
  extra_options?: Record<string, any>;
  is_valid: boolean;
  last_tested_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ============================================
// TABLE & SCHEMA TYPES
// ============================================
export interface TableInfo {
  id: string;
  name: string;
  description: string;
  rowCount: number;
  schema?: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  key: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  dataType: string;
  sortable: boolean;
  isPrimaryKey?: boolean;
  isNullable?: boolean;
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
  error?: string;
}

export interface GetTablesResponse {
  success: boolean;
  tables: TableInfo[];
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
