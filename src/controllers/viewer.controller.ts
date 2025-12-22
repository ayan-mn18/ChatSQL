import { Request, Response } from 'express';
import * as viewerService from '../services/viewer.service';
import * as emailService from '../services/email.service';
import * as authService from '../services/auth.service';
import { sequelize } from '../config/db';
import { QueryTypes } from 'sequelize';
import { logger } from '../utils/logger';

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
      }>(
        `SELECT DISTINCT vp.connection_id, c.name as connection_name, 
                vp.can_view_analytics, vp.can_use_ai
         FROM viewer_permissions vp
         JOIN connections c ON vp.connection_id = c.id
         WHERE vp.viewer_user_id = :userId`,
        { replacements: { userId }, type: QueryTypes.SELECT }
      );
      
      permissionsSummary = {
        connectionCount: permissions.length,
        canViewAnalytics: permissions.some(p => p.can_view_analytics),
        canUseAi: permissions.some(p => p.can_use_ai)
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
