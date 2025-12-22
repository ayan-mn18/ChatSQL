import { Request, Response } from 'express';
import * as viewerService from '../services/viewer.service';
import * as emailService from '../services/email.service';
import * as authService from '../services/auth.service';
import { sequelize } from '../config/db';
import { QueryTypes } from 'sequelize';
import { logger } from '../utils/logger';
import { getViewerActivityLog, logViewerActivity } from '../services/viewer-activity.service';
import { getRecentQueryHistoryByUser } from '../service/query-history.service';

/**
 * Create a new viewer
 * POST /api/viewers
 */
export const createViewer = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { email, username, isTemporary, expiresInHours, mustChangePassword, permissions, sendEmail } = req.body;

    // Validate required fields
    if (!email || !permissions || !Array.isArray(permissions) || permissions.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Email and at least one permission are required'
      });
      return;
    }

    // Check if admin is a super_admin
    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Only super admins can create viewers'
      });
      return;
    }

    // Create viewer
    const { viewer, tempPassword } = await viewerService.createViewer(adminUserId, {
      email,
      username,
      isTemporary: isTemporary || false,
      expiresInHours: expiresInHours || undefined,
      mustChangePassword: mustChangePassword ?? true,
      permissions
    });

    // Get admin info for email
    const admin = await authService.findById(adminUserId);
    const adminName = admin?.username || admin?.email || 'An administrator';

    // Send invitation email if requested
    if (sendEmail !== false) {
      await emailService.sendViewerInvitationEmail(
        email,
        tempPassword,
        adminName,
        viewer.expires_at || undefined,
        mustChangePassword ?? true
      );
    }

    res.status(201).json({
      success: true,
      message: 'Viewer created successfully',
      data: {
        viewer: {
          id: viewer.id,
          email: viewer.email,
          username: viewer.username,
          isTemporary: viewer.is_temporary,
          expiresAt: viewer.expires_at,
          createdAt: viewer.created_at
        },
        credentials: {
          email: viewer.email,
          tempPassword // Only returned once for copying
        }
      }
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Create viewer error:', error);
    
    if (error.message === 'A user with this email already exists') {
      res.status(409).json({ success: false, error: error.message });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create viewer'
    });
  }
};

/**
 * Check whether email/username can be used for a new viewer, or maps to an existing viewer.
 * POST /api/viewers/identity-check
 */
export const checkViewerIdentity = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Only super admins can manage viewers' });
      return;
    }

    const { email, username } = req.body as { email?: string; username?: string };
    const result = await viewerService.checkViewerIdentity(adminUserId, email || '', username);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Identity check error:', error);
    res.status(500).json({ success: false, error: 'Failed to check identity' });
  }
};

/**
 * Create a new viewer or add access to an existing viewer (by email)
 * POST /api/viewers/upsert
 */
export const upsertViewer = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Only super admins can manage viewers' });
      return;
    }

    const { email, username, isTemporary, expiresInHours, mustChangePassword, permissions, sendEmail } = req.body;

    if (!email || !permissions || !Array.isArray(permissions) || permissions.length === 0) {
      res.status(400).json({ success: false, error: 'Email and at least one permission are required' });
      return;
    }

    const result = await viewerService.upsertViewerByEmail(adminUserId, {
      email,
      username,
      isTemporary: !!isTemporary,
      expiresInHours: isTemporary ? (expiresInHours || undefined) : undefined,
      mustChangePassword,
      permissions
    });

    // Send invitation email only when a brand-new viewer is created
    if (result.created && sendEmail !== false && result.tempPassword) {
      const admin = await authService.findById(adminUserId);
      const adminName = admin?.username || admin?.email || 'An administrator';
      await emailService.sendViewerInvitationEmail(
        result.viewer.email,
        result.tempPassword,
        adminName,
        result.viewer.expires_at || undefined,
        mustChangePassword ?? true
      );
    }

    res.status(200).json({
      success: true,
      message: result.created ? 'Viewer created successfully' : 'Viewer access updated successfully',
      data: {
        created: result.created,
        viewer: {
          id: result.viewer.id,
          email: result.viewer.email,
          username: result.viewer.username,
          isTemporary: result.viewer.is_temporary,
          expiresAt: result.viewer.expires_at,
          isActive: result.viewer.is_active,
          mustChangePassword: result.viewer.must_change_password,
          createdAt: result.viewer.created_at
        },
        credentials: result.created && result.tempPassword
          ? { email: result.viewer.email, tempPassword: result.tempPassword }
          : undefined
      }
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Upsert viewer error:', error);
    const msg = error?.message || 'Failed to upsert viewer';
    if (msg.includes('already exists') || msg.includes('Username')) {
      res.status(409).json({ success: false, error: msg });
      return;
    }
    if (msg.includes('managed by another admin') || msg.includes('Only super admins')) {
      res.status(403).json({ success: false, error: msg });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to upsert viewer' });
  }
};

/**
 * Get all viewers created by the current admin
 * GET /api/viewers
 */
export const getViewers = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Only super admins can view viewers'
      });
      return;
    }

    const viewers = await viewerService.getViewersByAdmin(adminUserId);

    res.status(200).json({
      success: true,
      data: viewers.map(v => ({
        id: v.id,
        email: v.email,
        username: v.username,
        isTemporary: v.is_temporary,
        expiresAt: v.expires_at,
        isActive: v.is_active,
        mustChangePassword: v.must_change_password,
        createdAt: v.created_at,
        permissions: v.permissions.map(p => ({
          connectionId: p.connection_id,
          connectionName: p.connection_name,
          schemaName: p.schema_name,
          tableName: p.table_name,
          canSelect: p.can_select,
          canInsert: p.can_insert,
          canUpdate: p.can_update,
          canDelete: p.can_delete,
          canUseAi: p.can_use_ai,
          canViewAnalytics: p.can_view_analytics,
          canExport: p.can_export
        }))
      }))
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Get viewers error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get viewers'
    });
  }
};

/**
 * Get a single viewer by ID
 * GET /api/viewers/:id
 */
export const getViewer = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    const viewerId = req.params.id;
    
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Only super admins can view viewer details'
      });
      return;
    }

    const viewer = await viewerService.getViewerById(viewerId, adminUserId);
    
    if (!viewer) {
      res.status(404).json({
        success: false,
        error: 'Viewer not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: viewer.id,
        email: viewer.email,
        username: viewer.username,
        isTemporary: viewer.is_temporary,
        expiresAt: viewer.expires_at,
        isActive: viewer.is_active,
        mustChangePassword: viewer.must_change_password,
        createdAt: viewer.created_at,
        permissions: viewer.permissions.map(p => ({
          connectionId: p.connection_id,
          connectionName: p.connection_name,
          schemaName: p.schema_name,
          tableName: p.table_name,
          canSelect: p.can_select,
          canInsert: p.can_insert,
          canUpdate: p.can_update,
          canDelete: p.can_delete,
          canUseAi: p.can_use_ai,
          canViewAnalytics: p.can_view_analytics,
          canExport: p.can_export
        }))
      }
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Get viewer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get viewer'
    });
  }
};

/**
 * Revoke viewer access (soft delete)
 * POST /api/viewers/:id/revoke
 */
export const revokeViewer = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    const viewerId = req.params.id;
    
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Only super admins can revoke viewers'
      });
      return;
    }

    await viewerService.revokeViewer(viewerId, adminUserId);

    res.status(200).json({
      success: true,
      message: 'Viewer access revoked successfully'
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Revoke viewer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to revoke viewer'
    });
  }
};

/**
 * Delete viewer permanently
 * DELETE /api/viewers/:id
 */
export const deleteViewer = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    const viewerId = req.params.id;
    
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Only super admins can delete viewers'
      });
      return;
    }

    await viewerService.deleteViewer(viewerId, adminUserId);

    res.status(200).json({
      success: true,
      message: 'Viewer deleted successfully'
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Delete viewer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete viewer'
    });
  }
};

/**
 * Extend viewer expiry
 * POST /api/viewers/:id/extend
 */
export const extendViewerExpiry = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    const viewerId = req.params.id;
    const { additionalHours } = req.body;
    
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!additionalHours || additionalHours <= 0) {
      res.status(400).json({
        success: false,
        error: 'Valid additionalHours is required'
      });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Only super admins can extend viewer expiry'
      });
      return;
    }

    const viewer = await viewerService.extendViewerExpiry(viewerId, adminUserId, additionalHours);

    if (!viewer) {
      res.status(404).json({
        success: false,
        error: 'Viewer not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Viewer expiry extended by ${additionalHours} hours`,
      data: {
        newExpiresAt: viewer.expires_at
      }
    });

    await logViewerActivity({
      viewerUserId: viewerId,
      actionType: 'access_extended',
      actionDetails: { adminUserId, additionalHours, newExpiresAt: viewer.expires_at },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Extend viewer expiry error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to extend viewer expiry'
    });
  }
};

/**
 * Update viewer permissions
 * PUT /api/viewers/:id/permissions
 */
export const updateViewerPermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    const viewerId = req.params.id;
    const { permissions } = req.body;
    
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      res.status(400).json({
        success: false,
        error: 'At least one permission is required'
      });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Only super admins can update viewer permissions'
      });
      return;
    }

    await viewerService.updateViewerPermissions(viewerId, adminUserId, permissions);

    res.status(200).json({
      success: true,
      message: 'Viewer permissions updated successfully'
    });

    await logViewerActivity({
      viewerUserId: viewerId,
      actionType: 'permissions_updated',
      actionDetails: { adminUserId, permissionsCount: permissions.length },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Update permissions error:', error);
    
    if (error.message === 'Viewer not found or access denied') {
      res.status(404).json({ success: false, error: error.message });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to update viewer permissions'
    });
  }
};

/**
 * Resend viewer invitation email
 * POST /api/viewers/:id/resend-invite
 */
export const resendViewerInvite = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    const viewerId = req.params.id;
    
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Only super admins can resend invitations'
      });
      return;
    }

    const viewer = await viewerService.getViewerById(viewerId, adminUserId);
    
    if (!viewer) {
      res.status(404).json({
        success: false,
        error: 'Viewer not found'
      });
      return;
    }

    // Generate new password and update
    const newTempPassword = viewerService.generateTempPassword();
    const { hashPassword } = await import('../utils/auth');
    const passwordHash = await hashPassword(newTempPassword);
    
    // If it's a temporary viewer and already expired, extend it by 24 hours
    let newExpiresAt = viewer.expires_at;
    if (viewer.is_temporary && viewer.expires_at && new Date(viewer.expires_at) < new Date()) {
      newExpiresAt = new Date();
      newExpiresAt.setHours(newExpiresAt.getHours() + 24);
    }

    await sequelize.query(
      `UPDATE users 
       SET password_hash = :passwordHash, 
           must_change_password = true, 
           is_active = true,
           expires_at = :expiresAt,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = :viewerId`,
      { 
        replacements: { 
          passwordHash, 
          viewerId, 
          expiresAt: newExpiresAt 
        }, 
        type: QueryTypes.UPDATE 
      }
    );

    // Get admin info
    const admin = await authService.findById(adminUserId);
    const adminName = admin?.username || admin?.email || 'An administrator';

    // Send email
    await emailService.sendViewerInvitationEmail(
      viewer.email,
      newTempPassword,
      adminName,
      newExpiresAt || undefined
    );

    res.status(200).json({
      success: true,
      message: 'Invitation resent successfully',
      data: {
        credentials: {
          email: viewer.email,
          tempPassword: newTempPassword
        }
      }
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Resend invite error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resend invitation'
    });
  }
};

/**
 * Get current user's role and permissions (for frontend)
 * GET /api/viewers/me/role
 */
export const getCurrentUserRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const [user] = await sequelize.query<{
      role: string;
      is_temporary: boolean;
      expires_at: Date | null;
      must_change_password: boolean;
      created_by_user_id: string | null;
    }>(
      `SELECT role, is_temporary, expires_at, must_change_password, created_by_user_id 
       FROM users WHERE id = :userId LIMIT 1`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // If viewer, get their permissions summary
    let permissionsSummary = null;
    if (user.role === 'viewer') {
      const permissions = await sequelize.query<{
        connection_id: string;
        connection_name: string;
        can_view_analytics: boolean;
        can_use_ai: boolean;
        can_export: boolean;
      }>(
        `SELECT DISTINCT vp.connection_id, c.name as connection_name, 
                vp.can_view_analytics, vp.can_use_ai, vp.can_export
         FROM viewer_permissions vp
         JOIN connections c ON vp.connection_id = c.id
         WHERE vp.viewer_user_id = :userId`,
        { replacements: { userId }, type: QueryTypes.SELECT }
      );
      
      permissionsSummary = {
        connectionCount: permissions.length,
        canViewAnalytics: permissions.some(p => p.can_view_analytics),
        canUseAi: permissions.some(p => p.can_use_ai),
        canExport: permissions.some(p => p.can_export)
      };
    }

    res.status(200).json({
      success: true,
      data: {
        role: user.role || 'super_admin', // Default to super_admin for existing users
        isTemporary: user.is_temporary || false,
        expiresAt: user.expires_at,
        mustChangePassword: user.must_change_password || false,
        isViewer: user.role === 'viewer',
        isSuperAdmin: user.role !== 'viewer',
        permissions: permissionsSummary
      }
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Get current user role error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user role'
    });
  }
};

/**
 * Get current viewer's own access details (permissions + expiry)
 * GET /api/viewers/me
 */
export const getMyAccess = async (req: Request, res: Response): Promise<void> => {
  try {
    const viewerUserId = req.userId;
    if (!viewerUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const viewer = await viewerService.getViewerSelf(viewerUserId);
    if (!viewer) {
      res.status(404).json({ success: false, error: 'Viewer not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        id: viewer.id,
        email: viewer.email,
        username: viewer.username,
        isTemporary: viewer.is_temporary,
        expiresAt: viewer.expires_at,
        isActive: viewer.is_active,
        mustChangePassword: viewer.must_change_password,
        createdAt: viewer.created_at,
        permissions: viewer.permissions.map(p => ({
          connectionId: p.connection_id,
          connectionName: p.connection_name,
          schemaName: p.schema_name,
          tableName: p.table_name,
          canSelect: p.can_select,
          canInsert: p.can_insert,
          canUpdate: p.can_update,
          canDelete: p.can_delete,
          canUseAi: p.can_use_ai,
          canViewAnalytics: p.can_view_analytics,
          canExport: p.can_export,
        })),
      },
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Get my access error:', error);
    res.status(500).json({ success: false, error: 'Failed to get access details' });
  }
};

/**
 * Create an access request for the current viewer
 * POST /api/viewers/me/access-requests
 */
export const createMyAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const viewerUserId = req.userId;
    if (!viewerUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const { connectionId, schemaName, tableName, additionalHours, requestedPermissions } = req.body as {
      connectionId?: string;
      schemaName?: string | null;
      tableName?: string | null;
      additionalHours?: number;
      requestedPermissions?: viewerService.ViewerPermission[];
    };

    const hasHours = typeof additionalHours === 'number' && additionalHours > 0;
    const hasPerms = Array.isArray(requestedPermissions) && requestedPermissions.length > 0;

    if (!hasHours && !hasPerms) {
      res.status(400).json({ success: false, error: 'Provide additionalHours and/or requestedPermissions' });
      return;
    }

    const created = await viewerService.createViewerAccessRequest({
      viewerUserId,
      connectionId: connectionId ?? null,
      schemaName: schemaName ?? null,
      tableName: tableName ?? null,
      requestedAdditionalHours: hasHours ? additionalHours! : null,
      requestedPermissions: hasPerms ? requestedPermissions : null,
    });

    await logViewerActivity({
      viewerUserId,
      connectionId: connectionId ?? null,
      actionType: 'access_request_created',
      actionDetails: {
        requestId: created.id,
        requestedAdditionalHours: hasHours ? additionalHours : null,
        requestedPermissionsCount: hasPerms ? requestedPermissions!.length : 0,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    res.status(201).json({ success: true, data: { requestId: created.id } });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Create access request error:', error);
    res.status(500).json({ success: false, error: 'Failed to create access request' });
  }
};

/**
 * List access requests for the current admin
 * GET /api/viewers/access-requests
 */
export const getAccessRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Only super admins can view access requests' });
      return;
    }

    const requests = await viewerService.getAccessRequestsForAdmin(adminUserId);

    res.status(200).json({
      success: true,
      data: requests.map(r => ({
        id: r.id,
        viewerUserId: r.viewer_user_id,
        viewerEmail: r.viewer_email,
        viewerUsername: r.viewer_username,
        connectionId: r.connection_id,
        schemaName: r.schema_name,
        tableName: r.table_name,
        requestedAdditionalHours: r.requested_additional_hours,
        requestedPermissions: r.requested_permissions,
        status: r.status,
        decisionReason: r.decision_reason,
        decidedAt: r.decided_at,
        createdAt: r.created_at,
      })),
    });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Get access requests error:', error);
    res.status(500).json({ success: false, error: 'Failed to get access requests' });
  }
};

/**
 * Approve an access request
 * POST /api/viewers/access-requests/:requestId/approve
 */
export const approveAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Only super admins can approve access requests' });
      return;
    }

    const { reason } = req.body as { reason?: string };
    const updated = await viewerService.decideAccessRequest({
      requestId: req.params.requestId,
      adminUserId,
      decision: 'approved',
      reason: reason ?? null,
    });

    await logViewerActivity({
      viewerUserId: updated.viewer_user_id,
      connectionId: updated.connection_id,
      actionType: 'access_request_approved',
      actionDetails: { requestId: updated.id, adminUserId, reason: reason ?? null },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Approve access request error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to approve request' });
  }
};

/**
 * Deny an access request
 * POST /api/viewers/access-requests/:requestId/deny
 */
export const denyAccessRequest = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Only super admins can deny access requests' });
      return;
    }

    const { reason } = req.body as { reason?: string };
    const updated = await viewerService.decideAccessRequest({
      requestId: req.params.requestId,
      adminUserId,
      decision: 'denied',
      reason: reason ?? null,
    });

    await logViewerActivity({
      viewerUserId: updated.viewer_user_id,
      connectionId: updated.connection_id,
      actionType: 'access_request_denied',
      actionDetails: { requestId: updated.id, adminUserId, reason: reason ?? null },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    res.status(200).json({ success: true });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Deny access request error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to deny request' });
  }
};

/**
 * Get viewer activity log (admin only)
 * GET /api/viewers/:id/activity
 */
export const getViewerActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    const viewerId = req.params.id;
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Only super admins can view activity' });
      return;
    }

    // ownership check
    const viewer = await viewerService.getViewerById(viewerId, adminUserId);
    if (!viewer) {
      res.status(404).json({ success: false, error: 'Viewer not found' });
      return;
    }

    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
    const entries = await getViewerActivityLog(viewerId, limit);

    res.status(200).json({ success: true, data: entries });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Get viewer activity error:', error);
    res.status(500).json({ success: false, error: 'Failed to get viewer activity' });
  }
};

/**
 * Get viewer query history (admin only)
 * GET /api/viewers/:id/queries
 */
export const getViewerQueries = async (req: Request, res: Response): Promise<void> => {
  try {
    const adminUserId = req.userId;
    const viewerId = req.params.id;
    if (!adminUserId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const isAdmin = await viewerService.isSuperAdmin(adminUserId);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Only super admins can view queries' });
      return;
    }

    // ownership check
    const viewer = await viewerService.getViewerById(viewerId, adminUserId);
    if (!viewer) {
      res.status(404).json({ success: false, error: 'Viewer not found' });
      return;
    }

    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
    const queries = await getRecentQueryHistoryByUser(viewerId, limit);
    res.status(200).json({ success: true, data: queries });
  } catch (error: any) {
    logger.error('❌ [VIEWER] Get viewer queries error:', error);
    res.status(500).json({ success: false, error: 'Failed to get viewer queries' });
  }
};
