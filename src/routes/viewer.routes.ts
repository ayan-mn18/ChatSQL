import { Router } from 'express';
import { authenticate } from '../middleware';
import * as viewerController from '../controllers/viewer.controller';

const router = Router();

/**
 * @route   GET /api/viewers/me/role
 * @desc    Get current user's role and permissions
 * @access  Private
 */
router.get('/me/role', authenticate, viewerController.getCurrentUserRole);

/**
 * @route   POST /api/viewers
 * @desc    Create a new viewer
 * @access  Private (Super Admin only)
 */
router.post('/', authenticate, viewerController.createViewer);

/**
 * @route   GET /api/viewers
 * @desc    Get all viewers created by current admin
 * @access  Private (Super Admin only)
 */
router.get('/', authenticate, viewerController.getViewers);

/**
 * @route   GET /api/viewers/:id
 * @desc    Get a single viewer by ID
 * @access  Private (Super Admin only)
 */
router.get('/:id', authenticate, viewerController.getViewer);

/**
 * @route   POST /api/viewers/:id/revoke
 * @desc    Revoke viewer access (soft delete)
 * @access  Private (Super Admin only)
 */
router.post('/:id/revoke', authenticate, viewerController.revokeViewer);

/**
 * @route   DELETE /api/viewers/:id
 * @desc    Delete viewer permanently
 * @access  Private (Super Admin only)
 */
router.delete('/:id', authenticate, viewerController.deleteViewer);

/**
 * @route   POST /api/viewers/:id/extend
 * @desc    Extend viewer expiry time
 * @access  Private (Super Admin only)
 */
router.post('/:id/extend', authenticate, viewerController.extendViewerExpiry);

/**
 * @route   PUT /api/viewers/:id/permissions
 * @desc    Update viewer permissions
 * @access  Private (Super Admin only)
 */
router.put('/:id/permissions', authenticate, viewerController.updateViewerPermissions);

/**
 * @route   POST /api/viewers/:id/resend-invite
 * @desc    Resend invitation email with new credentials
 * @access  Private (Super Admin only)
 */
router.post('/:id/resend-invite', authenticate, viewerController.resendViewerInvite);

export default router;
