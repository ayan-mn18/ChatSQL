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
 * @route   GET /api/viewers/me
 * @desc    Get current viewer's access details
 * @access  Private
 */
router.get('/me', authenticate, viewerController.getMyAccess);

/**
 * @route   POST /api/viewers/me/access-requests
 * @desc    Create an access request for current viewer
 * @access  Private
 */
router.post('/me/access-requests', authenticate, viewerController.createMyAccessRequest);

/**
 * @route   GET /api/viewers/access-requests
 * @desc    List access requests for current admin
 * @access  Private (Super Admin only)
 */
router.get('/access-requests', authenticate, viewerController.getAccessRequests);

/**
 * @route   POST /api/viewers/access-requests/:requestId/approve
 * @desc    Approve access request
 * @access  Private (Super Admin only)
 */
router.post('/access-requests/:requestId/approve', authenticate, viewerController.approveAccessRequest);

/**
 * @route   POST /api/viewers/access-requests/:requestId/deny
 * @desc    Deny access request
 * @access  Private (Super Admin only)
 */
router.post('/access-requests/:requestId/deny', authenticate, viewerController.denyAccessRequest);

/**
 * @route   POST /api/viewers/identity-check
 * @desc    Check if email/username should create new viewer or add access to existing
 * @access  Private (Super Admin only)
 */
router.post('/identity-check', authenticate, viewerController.checkViewerIdentity);

/**
 * @route   POST /api/viewers/upsert
 * @desc    Create viewer or add access to existing viewer (by email)
 * @access  Private (Super Admin only)
 */
router.post('/upsert', authenticate, viewerController.upsertViewer);

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
 * @route   GET /api/viewers/:id/activity
 * @desc    Get viewer activity log
 * @access  Private (Super Admin only)
 */
router.get('/:id/activity', authenticate, viewerController.getViewerActivity);

/**
 * @route   GET /api/viewers/:id/queries
 * @desc    Get viewer query history
 * @access  Private (Super Admin only)
 */
router.get('/:id/queries', authenticate, viewerController.getViewerQueries);

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
