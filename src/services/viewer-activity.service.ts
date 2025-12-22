import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/db';
import { logger } from '../utils/logger';

export type ViewerActivityActionType =
  | 'login'
  | 'password_changed'
  | 'query_executed'
  | 'access_request_created'
  | 'access_request_approved'
  | 'access_request_denied'
  | 'permissions_updated'
  | 'access_extended';

export interface LogViewerActivityParams {
  viewerUserId: string;
  connectionId?: string | null;
  actionType: ViewerActivityActionType;
  actionDetails?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function isViewerUser(userId: string): Promise<boolean> {
  const rows = await sequelize.query<{ role: string; is_active: boolean }>(
    `SELECT role, is_active FROM users WHERE id = :userId LIMIT 1`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return rows[0]?.role === 'viewer' && rows[0]?.is_active === true;
}

export async function logViewerActivity(params: LogViewerActivityParams): Promise<void> {
  try {
    const shouldLog = await isViewerUser(params.viewerUserId);
    if (!shouldLog) return;

    await sequelize.query(
      `INSERT INTO viewer_activity_log (
        viewer_user_id,
        connection_id,
        action_type,
        action_details,
        ip_address,
        user_agent
      ) VALUES (
        :viewerUserId,
        :connectionId,
        :actionType,
        :actionDetails,
        :ipAddress,
        :userAgent
      )`,
      {
        replacements: {
          viewerUserId: params.viewerUserId,
          connectionId: params.connectionId ?? null,
          actionType: params.actionType,
          actionDetails: params.actionDetails ? JSON.stringify(params.actionDetails) : null,
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
        },
        type: QueryTypes.INSERT,
      }
    );
  } catch (error) {
    logger.warn('[VIEWER_ACTIVITY] Failed to write activity log', { error });
  }
}

export interface ViewerActivityLogEntry {
  id: string;
  viewerUserId: string;
  connectionId: string | null;
  actionType: string;
  actionDetails: any;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  connectionName?: string | null;
}

export async function getViewerActivityLog(
  viewerUserId: string,
  limit: number = 50
): Promise<ViewerActivityLogEntry[]> {
  const safeLimit = Math.max(1, Math.min(200, limit));

  return sequelize.query<ViewerActivityLogEntry>(
    `SELECT
      val.id,
      val.viewer_user_id as "viewerUserId",
      val.connection_id as "connectionId",
      val.action_type as "actionType",
      val.action_details as "actionDetails",
      val.ip_address as "ipAddress",
      val.user_agent as "userAgent",
      val.created_at as "createdAt",
      c.name as "connectionName"
    FROM viewer_activity_log val
    LEFT JOIN connections c ON c.id = val.connection_id
    WHERE val.viewer_user_id = :viewerUserId
    ORDER BY val.created_at DESC
    LIMIT :limit`,
    { replacements: { viewerUserId, limit: safeLimit }, type: QueryTypes.SELECT }
  );
}
