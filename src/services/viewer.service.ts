import { sequelize } from '../config/db';
import { QueryTypes } from 'sequelize';
import { logger } from '../utils/logger';
import { hashPassword, generateAccessToken } from '../utils/auth';
import { sendViewerInvitationEmail } from './email.service';
import crypto from 'crypto';

// ============================================
// TYPES
// ============================================
export interface ViewerPermission {
  connectionId: string;
  schemaName: string | null;  // null = all schemas
  tableName: string | null;   // null = all tables in schema
  canSelect: boolean;
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canUseAi: boolean;
  canViewAnalytics: boolean;
  canExport: boolean;
}

export interface CreateViewerRequest {
  email: string;
  username?: string;
  isTemporary: boolean;
  expiresInHours?: number;  // For temporary viewers
  permissions: ViewerPermission[];
}

export interface Viewer {
  id: string;
  email: string;
  username: string | null;
  role: string;
  is_temporary: boolean;
  expires_at: Date | null;
  is_active: boolean;
  must_change_password: boolean;
  created_by_user_id: string;
  created_at: Date;
}

export interface ViewerWithPermissions extends Viewer {
  permissions: ViewerPermissionRecord[];
}

export interface ViewerPermissionRecord {
  id: string;
  viewer_user_id: string;
  connection_id: string;
  connection_name?: string;
  schema_name: string | null;
  table_name: string | null;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_use_ai: boolean;
  can_view_analytics: boolean;
  can_export: boolean;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate a secure random password
 */
export const generateTempPassword = (length = 12): string => {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }
  return password;
};

/**
 * Check if a user is a super admin
 */
export const isSuperAdmin = async (userId: string): Promise<boolean> => {
  const result = await sequelize.query<{ role: string }>(
    `SELECT role FROM users WHERE id = :userId AND is_active = true LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return result[0]?.role === 'super_admin';
};

/**
 * Check if email already exists
 */
export const emailExists = async (email: string): Promise<boolean> => {
  const result = await sequelize.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM users WHERE email = :email`,
    { replacements: { email }, type: QueryTypes.SELECT }
  );
  return parseInt(result[0]?.count || '0') > 0;
};

// ============================================
// VIEWER MANAGEMENT
// ============================================

/**
 * Create a new viewer user with permissions
 */
export const createViewer = async (
  createdByUserId: string,
  request: CreateViewerRequest
): Promise<{ viewer: Viewer; tempPassword: string }> => {
  const transaction = await sequelize.transaction();
  
  try {
    // Check if creator is super admin
    const isAdmin = await isSuperAdmin(createdByUserId);
    if (!isAdmin) {
      throw new Error('Only super admins can create viewers');
    }
    
    // Check if email already exists
    if (await emailExists(request.email)) {
      throw new Error('A user with this email already exists');
    }
    
    // Generate temporary password
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    
    // Calculate expiry date for temporary viewers
    let expiresAt: Date | null = null;
    if (request.isTemporary && request.expiresInHours) {
      expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + request.expiresInHours);
    }
    
    // Create user with viewer role
    const [viewer] = await sequelize.query<Viewer>(
      `INSERT INTO users (
        email, 
        password_hash, 
        username, 
        role, 
        is_temporary, 
        expires_at, 
        is_verified,
        is_active,
        must_change_password,
        created_by_user_id
      ) VALUES (
        :email, 
        :password_hash, 
        :username, 
        'viewer', 
        :is_temporary, 
        :expires_at,
        true,
        true,
        true,
        :created_by_user_id
      ) RETURNING *`,
      {
        replacements: {
          email: request.email,
          password_hash: passwordHash,
          username: request.username || null,
          is_temporary: request.isTemporary,
          expires_at: expiresAt,
          created_by_user_id: createdByUserId
        },
        type: QueryTypes.SELECT,
        transaction
      }
    );
    
    // Create permissions for each connection/schema/table
    for (const perm of request.permissions) {
      await sequelize.query(
        `INSERT INTO viewer_permissions (
          viewer_user_id,
          connection_id,
          schema_name,
          table_name,
          can_select,
          can_insert,
          can_update,
          can_delete,
          can_use_ai,
          can_view_analytics,
          can_export
        ) VALUES (
          :viewer_user_id,
          :connection_id,
          :schema_name,
          :table_name,
          :can_select,
          :can_insert,
          :can_update,
          :can_delete,
          :can_use_ai,
          :can_view_analytics,
          :can_export
        )`,
        {
          replacements: {
            viewer_user_id: viewer.id,
            connection_id: perm.connectionId,
            schema_name: perm.schemaName,
            table_name: perm.tableName,
            can_select: perm.canSelect,
            can_insert: perm.canInsert,
            can_update: perm.canUpdate,
            can_delete: perm.canDelete,
            can_use_ai: perm.canUseAi,
            can_view_analytics: perm.canViewAnalytics,
            can_export: perm.canExport
          },
          type: QueryTypes.INSERT,
          transaction
        }
      );
    }
    
    await transaction.commit();
    
    logger.info(`✅ [VIEWER] Created viewer ${request.email} by admin ${createdByUserId}`);
    
    return { viewer, tempPassword };
  } catch (error) {
    await transaction.rollback();
    logger.error(`❌ [VIEWER] Failed to create viewer:`, error);
    throw error;
  }
};

/**
 * Get all viewers created by a super admin
 */
export const getViewersByAdmin = async (adminUserId: string): Promise<ViewerWithPermissions[]> => {
  // Get viewers
  const viewers = await sequelize.query<Viewer>(
    `SELECT 
      id, email, username, role, is_temporary, expires_at, 
      is_active, must_change_password, created_by_user_id, created_at
     FROM users 
     WHERE created_by_user_id = :adminUserId AND role = 'viewer'
     ORDER BY created_at DESC`,
    { replacements: { adminUserId }, type: QueryTypes.SELECT }
  );
  
  // Get permissions for each viewer
  const viewersWithPermissions: ViewerWithPermissions[] = [];
  
  for (const viewer of viewers) {
    const permissions = await sequelize.query<ViewerPermissionRecord>(
      `SELECT vp.*, c.name as connection_name
       FROM viewer_permissions vp
       JOIN connections c ON vp.connection_id = c.id
       WHERE vp.viewer_user_id = :viewerId`,
      { replacements: { viewerId: viewer.id }, type: QueryTypes.SELECT }
    );
    
    viewersWithPermissions.push({
      ...viewer,
      permissions
    });
  }
  
  return viewersWithPermissions;
};

/**
 * Get a single viewer by ID
 */
export const getViewerById = async (viewerId: string, adminUserId: string): Promise<ViewerWithPermissions | null> => {
  const [viewer] = await sequelize.query<Viewer>(
    `SELECT 
      id, email, username, role, is_temporary, expires_at, 
      is_active, must_change_password, created_by_user_id, created_at
     FROM users 
     WHERE id = :viewerId AND created_by_user_id = :adminUserId AND role = 'viewer'
     LIMIT 1`,
    { replacements: { viewerId, adminUserId }, type: QueryTypes.SELECT }
  );
  
  if (!viewer) return null;
  
  const permissions = await sequelize.query<ViewerPermissionRecord>(
    `SELECT vp.*, c.name as connection_name
     FROM viewer_permissions vp
     JOIN connections c ON vp.connection_id = c.id
     WHERE vp.viewer_user_id = :viewerId`,
    { replacements: { viewerId }, type: QueryTypes.SELECT }
  );
  
  return { ...viewer, permissions };
};

/**
 * Revoke (deactivate) a viewer
 */
export const revokeViewer = async (viewerId: string, adminUserId: string): Promise<boolean> => {
  const result = await sequelize.query(
    `UPDATE users 
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = :viewerId AND created_by_user_id = :adminUserId AND role = 'viewer'`,
    { replacements: { viewerId, adminUserId }, type: QueryTypes.UPDATE }
  );
  
  logger.info(`✅ [VIEWER] Revoked viewer ${viewerId} by admin ${adminUserId}`);
  return true;
};

/**
 * Permanently delete a viewer and their permissions
 */
export const deleteViewer = async (viewerId: string, adminUserId: string): Promise<boolean> => {
  const transaction = await sequelize.transaction();
  
  try {
    // Delete permissions first (due to FK constraint)
    await sequelize.query(
      `DELETE FROM viewer_permissions WHERE viewer_user_id = :viewerId`,
      { replacements: { viewerId }, type: QueryTypes.DELETE, transaction }
    );
    
    // Delete the user
    await sequelize.query(
      `DELETE FROM users 
       WHERE id = :viewerId AND created_by_user_id = :adminUserId AND role = 'viewer'`,
      { replacements: { viewerId, adminUserId }, type: QueryTypes.DELETE, transaction }
    );
    
    await transaction.commit();
    logger.info(`✅ [VIEWER] Deleted viewer ${viewerId} by admin ${adminUserId}`);
    return true;
  } catch (error) {
    await transaction.rollback();
    logger.error(`❌ [VIEWER] Failed to delete viewer:`, error);
    throw error;
  }
};

/**
 * Extend a temporary viewer's expiry
 */
export const extendViewerExpiry = async (
  viewerId: string, 
  adminUserId: string, 
  additionalHours: number
): Promise<Viewer | null> => {
  const [viewer] = await sequelize.query<Viewer>(
    `UPDATE users 
     SET expires_at = COALESCE(expires_at, CURRENT_TIMESTAMP) + interval '1 hour' * :hours,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = :viewerId AND created_by_user_id = :adminUserId AND role = 'viewer'
     RETURNING *`,
    { 
      replacements: { viewerId, adminUserId, hours: additionalHours }, 
      type: QueryTypes.SELECT 
    }
  );
  
  if (viewer) {
    logger.info(`✅ [VIEWER] Extended expiry for viewer ${viewerId} by ${additionalHours} hours`);
  }
  
  return viewer || null;
};

/**
 * Update viewer permissions
 */
export const updateViewerPermissions = async (
  viewerId: string,
  adminUserId: string,
  permissions: ViewerPermission[]
): Promise<boolean> => {
  const transaction = await sequelize.transaction();
  
  try {
    // Verify ownership
    const [viewer] = await sequelize.query<{ id: string }>(
      `SELECT id FROM users WHERE id = :viewerId AND created_by_user_id = :adminUserId AND role = 'viewer'`,
      { replacements: { viewerId, adminUserId }, type: QueryTypes.SELECT }
    );
    
    if (!viewer) {
      throw new Error('Viewer not found or access denied');
    }
    
    // Delete existing permissions
    await sequelize.query(
      `DELETE FROM viewer_permissions WHERE viewer_user_id = :viewerId`,
      { replacements: { viewerId }, type: QueryTypes.DELETE, transaction }
    );
    
    // Insert new permissions
    for (const perm of permissions) {
      await sequelize.query(
        `INSERT INTO viewer_permissions (
          viewer_user_id,
          connection_id,
          schema_name,
          table_name,
          can_select,
          can_insert,
          can_update,
          can_delete,
          can_use_ai,
          can_view_analytics,
          can_export
        ) VALUES (
          :viewer_user_id,
          :connection_id,
          :schema_name,
          :table_name,
          :can_select,
          :can_insert,
          :can_update,
          :can_delete,
          :can_use_ai,
          :can_view_analytics,
          :can_export
        )`,
        {
          replacements: {
            viewer_user_id: viewerId,
            connection_id: perm.connectionId,
            schema_name: perm.schemaName,
            table_name: perm.tableName,
            can_select: perm.canSelect,
            can_insert: perm.canInsert,
            can_update: perm.canUpdate,
            can_delete: perm.canDelete,
            can_use_ai: perm.canUseAi,
            can_view_analytics: perm.canViewAnalytics,
            can_export: perm.canExport
          },
          type: QueryTypes.INSERT,
          transaction
        }
      );
    }
    
    await transaction.commit();
    logger.info(`✅ [VIEWER] Updated permissions for viewer ${viewerId}`);
    return true;
  } catch (error) {
    await transaction.rollback();
    logger.error(`❌ [VIEWER] Failed to update viewer permissions:`, error);
    throw error;
  }
};

// ============================================
// PERMISSION CHECKING (for use in other services)
// ============================================

/**
 * Get viewer's accessible connections
 */
export const getViewerConnections = async (viewerUserId: string): Promise<string[]> => {
  const result = await sequelize.query<{ connection_id: string }>(
    `SELECT DISTINCT connection_id FROM viewer_permissions WHERE viewer_user_id = :viewerUserId`,
    { replacements: { viewerUserId }, type: QueryTypes.SELECT }
  );
  return result.map(r => r.connection_id);
};

/**
 * Check if viewer has access to a specific connection
 */
export const viewerHasConnectionAccess = async (
  viewerUserId: string, 
  connectionId: string
): Promise<boolean> => {
  const result = await sequelize.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM viewer_permissions 
     WHERE viewer_user_id = :viewerUserId AND connection_id = :connectionId`,
    { replacements: { viewerUserId, connectionId }, type: QueryTypes.SELECT }
  );
  return parseInt(result[0]?.count || '0') > 0;
};

/**
 * Get viewer's permissions for a specific connection
 */
export const getViewerConnectionPermissions = async (
  viewerUserId: string,
  connectionId: string
): Promise<ViewerPermissionRecord[]> => {
  return sequelize.query<ViewerPermissionRecord>(
    `SELECT * FROM viewer_permissions 
     WHERE viewer_user_id = :viewerUserId AND connection_id = :connectionId`,
    { replacements: { viewerUserId, connectionId }, type: QueryTypes.SELECT }
  );
};

/**
 * Check if viewer can perform a specific operation on a table
 */
export const checkViewerTablePermission = async (
  viewerUserId: string,
  connectionId: string,
  schemaName: string,
  tableName: string,
  operation: 'select' | 'insert' | 'update' | 'delete'
): Promise<boolean> => {
  const columnMap = {
    select: 'can_select',
    insert: 'can_insert',
    update: 'can_update',
    delete: 'can_delete'
  };
  
  const column = columnMap[operation];
  
  // Check for most specific to least specific permission
  const result = await sequelize.query<{ has_permission: boolean }>(
    `SELECT ${column} as has_permission FROM viewer_permissions
     WHERE viewer_user_id = :viewerUserId
       AND connection_id = :connectionId
       AND (schema_name = :schemaName OR schema_name IS NULL)
       AND (table_name = :tableName OR table_name IS NULL)
     ORDER BY 
       CASE WHEN table_name IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN schema_name IS NOT NULL THEN 0 ELSE 1 END
     LIMIT 1`,
    { 
      replacements: { viewerUserId, connectionId, schemaName, tableName }, 
      type: QueryTypes.SELECT 
    }
  );
  
  return result[0]?.has_permission || false;
};

/**
 * Get viewer's allowed schemas for a connection
 * Returns schema names viewer has access to (or empty for all)
 */
export const getViewerAllowedSchemas = async (
  viewerUserId: string,
  connectionId: string
): Promise<{ schemas: string[] | null; hasFullAccess: boolean }> => {
  const permissions = await sequelize.query<{ schema_name: string | null }>(
    `SELECT DISTINCT schema_name FROM viewer_permissions 
     WHERE viewer_user_id = :viewerUserId AND connection_id = :connectionId`,
    { replacements: { viewerUserId, connectionId }, type: QueryTypes.SELECT }
  );
  
  // If any permission has schema_name = null, viewer has full schema access
  const hasFullAccess = permissions.some(p => p.schema_name === null);
  
  if (hasFullAccess) {
    return { schemas: null, hasFullAccess: true };
  }
  
  const schemas = permissions
    .filter(p => p.schema_name !== null)
    .map(p => p.schema_name as string);
  
  return { schemas, hasFullAccess: false };
};

/**
 * Get viewer's allowed tables for a specific schema in a connection
 * Returns table names viewer has access to (or null for all)
 */
export const getViewerAllowedTables = async (
  viewerUserId: string,
  connectionId: string,
  schemaName: string
): Promise<{ tables: string[] | null; hasFullAccess: boolean }> => {
  const permissions = await sequelize.query<{ table_name: string | null }>(
    `SELECT DISTINCT table_name FROM viewer_permissions 
     WHERE viewer_user_id = :viewerUserId 
       AND connection_id = :connectionId
       AND (schema_name = :schemaName OR schema_name IS NULL)`,
    { replacements: { viewerUserId, connectionId, schemaName }, type: QueryTypes.SELECT }
  );
  
  // If any permission has table_name = null, viewer has full table access for this schema
  const hasFullAccess = permissions.some(p => p.table_name === null);
  
  if (hasFullAccess) {
    return { tables: null, hasFullAccess: true };
  }
  
  const tables = permissions
    .filter(p => p.table_name !== null)
    .map(p => p.table_name as string);
  
  return { tables, hasFullAccess: false };
};

/**
 * Get all expired temporary viewers that need to be deactivated
 */
export const getExpiredViewers = async (): Promise<Viewer[]> => {
  return sequelize.query<Viewer>(
    `SELECT * FROM users 
     WHERE role = 'viewer' 
       AND is_temporary = true 
       AND is_active = true 
       AND expires_at IS NOT NULL 
       AND expires_at < CURRENT_TIMESTAMP`,
    { type: QueryTypes.SELECT }
  );
};

/**
 * Deactivate expired viewers
 */
export const deactivateExpiredViewers = async (): Promise<number> => {
  const [, metadata] = await sequelize.query(
    `UPDATE users 
     SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE role = 'viewer' 
       AND is_temporary = true 
       AND is_active = true 
       AND expires_at IS NOT NULL 
       AND expires_at < CURRENT_TIMESTAMP`
  );
  
  const count = (metadata as any)?.rowCount || 0;
  if (count > 0) {
    logger.info(`✅ [VIEWER] Deactivated ${count} expired viewers`);
  }
  return count;
};
