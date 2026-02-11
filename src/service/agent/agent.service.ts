// ============================================
// AGENT SERVICE
// Core agent loop: plan → propose → wait-for-approval → execute → handle-error → iterate
//
// Design: The agent session lives in-memory on the server.
// The SSE connection streams events to the frontend.
// The frontend calls REST endpoints to approve/reject/provide results.
// The agent uses EventEmitter-style resolve/reject callbacks to pause
// at "waiting" points (approval, execution results).
// ============================================

import { randomUUID } from 'crypto';
import { Response } from 'express';
import { complete, getModelForTier, ChatMessage as LLMChatMessage } from '../llm';
import { logger } from '../../utils/logger';
import type { ChatMessage } from '../../services/chat.service';
import {
  AgentSession,
  AgentSessionStatus,
  AgentStep,
  AgentExecutionResult,
  AgentSSEEvent,
} from './agent.types';
import {
  getPlanningPrompt,
  getErrorRecoveryPrompt,
  getAnalysisPrompt,
  buildPlanningUserMessage,
  buildErrorRecoveryMessage,
  buildAnalysisMessage,
} from './agent.prompts';

// ============================================
// IN-MEMORY SESSION STORE
// ============================================

const activeSessions = new Map<string, AgentSession>();

// Deferred callbacks for when the agent is waiting on user input
interface DeferredAction {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

const pendingApprovals = new Map<string, DeferredAction>();
const pendingExecutions = new Map<string, DeferredAction>();

// SSE response references (to send events to the client)
const sseConnections = new Map<string, Response>();

// ============================================
// PUBLIC API
// ============================================

export function getAgentSession(agentSessionId: string): AgentSession | undefined {
  return activeSessions.get(agentSessionId);
}

/**
 * Start an agent session. This kicks off the agent loop.
 * The caller should set up SSE headers before calling this.
 */
export async function startAgentSession(
  res: Response,
  config: {
    connectionId: string;
    userId: string;
    sessionId: string;
    message: string;
    schemaContext: string;
    selectedSchemas: string[];
    chatHistory?: ChatMessage[];
  }
): Promise<AgentSession> {
  const agentSessionId = randomUUID();

  const session: AgentSession = {
    id: agentSessionId,
    connectionId: config.connectionId,
    userId: config.userId,
    sessionId: config.sessionId,
    originalMessage: config.message,
    schemaContext: config.schemaContext,
    selectedSchemas: config.selectedSchemas,
    status: 'planning',
    plan: [],
    currentStepIndex: 0,
    maxRetries: 3,
    totalRetries: 0,
    createdAt: new Date(),
  };

  activeSessions.set(agentSessionId, session);
  sseConnections.set(agentSessionId, res);

  // Send initial session info
  sendSSE(agentSessionId, { type: 'agent_thinking', sessionId: agentSessionId, message: 'Analyzing your request and creating a plan...' });

  // Run the agent loop in the background (don't await — it runs via SSE)
  runAgentLoop(agentSessionId, config.chatHistory).catch((err) => {
    logger.error(`[AGENT] Loop error for ${agentSessionId}:`, err);
    sendSSE(agentSessionId, {
      type: 'agent_error',
      sessionId: agentSessionId,
      error: err.message || 'Agent loop failed',
      recoverable: false,
    });
    cleanupSession(agentSessionId);
  });

  return session;
}

/**
 * User approves the current proposed query (optionally with edits)
 */
export function approveStep(agentSessionId: string, modifiedSql?: string): boolean {
  const deferred = pendingApprovals.get(agentSessionId);
  if (!deferred) {
    logger.warn(`[AGENT] No pending approval for ${agentSessionId}`);
    return false;
  }

  pendingApprovals.delete(agentSessionId);
  deferred.resolve({ approved: true, sql: modifiedSql });
  return true;
}

/**
 * User rejects the current proposed query
 */
export function rejectStep(agentSessionId: string, reason?: string): boolean {
  const deferred = pendingApprovals.get(agentSessionId);
  if (!deferred) {
    logger.warn(`[AGENT] No pending approval for ${agentSessionId}`);
    return false;
  }

  pendingApprovals.delete(agentSessionId);
  deferred.resolve({ approved: false, reason });
  return true;
}

/**
 * Frontend provides execution results after running the query
 */
export function provideExecutionResult(agentSessionId: string, result: AgentExecutionResult): boolean {
  const deferred = pendingExecutions.get(agentSessionId);
  if (!deferred) {
    logger.warn(`[AGENT] No pending execution for ${agentSessionId}`);
    return false;
  }

  pendingExecutions.delete(agentSessionId);
  deferred.resolve(result);
  return true;
}

/**
 * User stops the agent session
 */
export function stopAgentSession(agentSessionId: string): boolean {
  const session = activeSessions.get(agentSessionId);
  if (!session) return false;

  session.status = 'stopped';

  // Reject any pending operations
  const approval = pendingApprovals.get(agentSessionId);
  if (approval) {
    pendingApprovals.delete(agentSessionId);
    approval.reject(new Error('Session stopped by user'));
  }
  const execution = pendingExecutions.get(agentSessionId);
  if (execution) {
    pendingExecutions.delete(agentSessionId);
    execution.reject(new Error('Session stopped by user'));
  }

  sendSSE(agentSessionId, {
    type: 'agent_stopped',
    sessionId: agentSessionId,
    message: 'Agent session stopped',
  });

  cleanupSession(agentSessionId);
  return true;
}

/**
 * Attach a new SSE connection to an existing session
 * (e.g., if the client reconnects)
 */
export function attachSSE(agentSessionId: string, res: Response): boolean {
  const session = activeSessions.get(agentSessionId);
  if (!session) return false;
  sseConnections.set(agentSessionId, res);
  return true;
}

// ============================================
// AGENT LOOP (CORE)
// ============================================

async function runAgentLoop(
  agentSessionId: string,
  chatHistory?: ChatMessage[]
): Promise<void> {
  const session = activeSessions.get(agentSessionId);
  if (!session) throw new Error('Session not found');

  // Helper: status can be mutated externally by stopAgentSession
  const isStopped = () => (session.status as string) === 'stopped';

  try {
    // PHASE 1: Generate plan
    session.status = 'planning';
    const plan = await generatePlan(session, chatHistory);
    session.plan = plan.steps;

    // Send plan to client
    sendSSE(agentSessionId, {
      type: 'agent_plan',
      sessionId: agentSessionId,
      plan: plan.steps.map(s => ({ id: s.id, description: s.description })),
      message: plan.explanation,
    });

    // PHASE 2: Execute each step
    for (let i = 0; i < session.plan.length; i++) {
      if (isStopped()) return;

      session.currentStepIndex = i;
      const step = session.plan[i];
      step.status = 'active';

      // Propose the query
      session.status = 'proposing';
      sendSSE(agentSessionId, {
        type: 'agent_proposal',
        sessionId: agentSessionId,
        stepIndex: i,
        stepDescription: step.description,
        sql: step.sql!,
        explanation: step.description,
        isRetry: false,
        retryCount: 0,
      });

      // Wait for user approval
      const approval = await waitForApproval(agentSessionId);

      if (isStopped()) return;

      if (!approval.approved) {
        // User rejected — skip this step
        step.status = 'skipped';
        sendSSE(agentSessionId, {
          type: 'agent_thinking',
          sessionId: agentSessionId,
          message: approval.reason
            ? `Step skipped. Reason: ${approval.reason}`
            : 'Step skipped by user.',
        });
        continue;
      }

      // Use modified SQL if user edited it
      const sqlToExecute = approval.sql || step.sql!;
      step.sql = sqlToExecute;

      // Execute with retry loop
      let executed = false;
      let retryCount = 0;

      while (!executed && retryCount <= session.maxRetries) {
        if (isStopped()) return;

        // Tell frontend to execute
        session.status = 'executing';
        step.status = 'approved';
        sendSSE(agentSessionId, {
          type: 'agent_executing',
          sessionId: agentSessionId,
          stepIndex: i,
          sql: step.sql!,
        });

        // Wait for execution results from frontend
        const result = await waitForExecutionResult(agentSessionId);

        if (isStopped()) return;

        step.result = result;

        // Send result event
        sendSSE(agentSessionId, {
          type: 'agent_result',
          sessionId: agentSessionId,
          stepIndex: i,
          success: result.success,
          rowCount: result.rowCount,
          affectedRows: result.affectedRows,
          executionTime: result.executionTime,
          preview: result.rows?.slice(0, 5),
          error: result.error,
          errorDetails: result.errorDetails,
        });

        if (result.success) {
          step.status = 'executed';
          executed = true;

          // Analyze results briefly
          const summary = await analyzeResults(session, step);
          if (summary) {
            sendSSE(agentSessionId, {
              type: 'content',
              content: summary,
            });
          }
        } else {
          // Error — attempt recovery
          retryCount++;
          step.retryCount = retryCount;
          session.totalRetries++;

          if (retryCount > session.maxRetries) {
            step.status = 'failed';
            step.error = result.error || 'Query failed';
            sendSSE(agentSessionId, {
              type: 'agent_error',
              sessionId: agentSessionId,
              error: `Step ${i + 1} failed after ${retryCount} retries: ${result.error}`,
              recoverable: false,
            });
            break;
          }

          // Generate fixed query
          session.status = 'error_recovery';
          sendSSE(agentSessionId, {
            type: 'agent_thinking',
            sessionId: agentSessionId,
            message: `Error encountered. Analyzing and fixing (attempt ${retryCount}/${session.maxRetries})...`,
          });

          const fixedSql = await recoverFromError(session, step, result, retryCount);
          step.sql = fixedSql.sql;

          // Propose the fixed query
          session.status = 'proposing';
          sendSSE(agentSessionId, {
            type: 'agent_proposal',
            sessionId: agentSessionId,
            stepIndex: i,
            stepDescription: step.description,
            sql: fixedSql.sql,
            explanation: fixedSql.explanation,
            isRetry: true,
            retryCount,
          });

          // Wait for approval of fix
          const fixApproval = await waitForApproval(agentSessionId);

          if (isStopped()) return;

          if (!fixApproval.approved) {
            step.status = 'skipped';
            break;
          }

          // Use modified SQL if provided
          if (fixApproval.sql) {
            step.sql = fixApproval.sql;
          }
        }
      }
    }

    // PHASE 3: Complete
    if (!isStopped()) {
      session.status = 'completed';
      const stepsCompleted = session.plan.filter(s => s.status === 'executed').length;

      sendSSE(agentSessionId, {
        type: 'agent_complete',
        sessionId: agentSessionId,
        summary: `Completed ${stepsCompleted} of ${session.plan.length} steps.`,
        stepsCompleted,
        totalSteps: session.plan.length,
      });
    }
  } catch (err: any) {
    if (err.message === 'Session stopped by user') {
      // Already handled
      return;
    }
    throw err;
  } finally {
    // Clean up after a small delay to ensure last SSE events are delivered
    setTimeout(() => cleanupSession(agentSessionId), 5000);
  }
}

// ============================================
// LLM OPERATIONS
// ============================================

async function generatePlan(
  session: AgentSession,
  chatHistory?: ChatMessage[]
): Promise<{ steps: AgentStep[]; explanation: string }> {
  const messages: LLMChatMessage[] = [
    { role: 'system', content: getPlanningPrompt(session.schemaContext) },
    {
      role: 'user',
      content: buildPlanningUserMessage(
        session.originalMessage,
        chatHistory?.slice(-4).map(m => ({ role: m.role, content: m.content }))
      ),
    },
  ];

  const { provider, model } = getModelForTier('powerful');

  logger.info(`[AGENT] Generating plan with ${provider}/${model}`);

  const response = await complete(messages, { provider, model, temperature: 0.2 });

  // Parse JSON from response
  const parsed = parseJsonResponse(response.content);

  if (!parsed?.plan || !Array.isArray(parsed.plan)) {
    throw new Error('Failed to generate a valid plan');
  }

  const steps: AgentStep[] = parsed.plan.map((p: any, idx: number) => ({
    id: idx + 1,
    description: p.description || `Step ${idx + 1}`,
    sql: p.sql,
    status: 'pending' as const,
    retryCount: 0,
  }));

  return {
    steps,
    explanation: parsed.explanation || 'Plan generated.',
  };
}

async function recoverFromError(
  session: AgentSession,
  step: AgentStep,
  result: AgentExecutionResult,
  retryCount: number
): Promise<{ sql: string; explanation: string }> {
  const messages: LLMChatMessage[] = [
    { role: 'system', content: getErrorRecoveryPrompt(session.schemaContext) },
    {
      role: 'user',
      content: buildErrorRecoveryMessage(
        step.sql || '',
        result.error || 'Unknown error',
        result.errorDetails,
        retryCount
      ),
    },
  ];

  const { provider, model } = getModelForTier('powerful');

  logger.info(`[AGENT] Attempting error recovery (retry ${retryCount}) with ${provider}/${model}`);

  const response = await complete(messages, { provider, model, temperature: 0.1 });
  const parsed = parseJsonResponse(response.content);

  if (!parsed?.sql) {
    throw new Error('Failed to generate a recovery query');
  }

  return {
    sql: parsed.sql,
    explanation: parsed.explanation || 'Fixed the query.',
  };
}

async function analyzeResults(
  session: AgentSession,
  step: AgentStep
): Promise<string | null> {
  if (!step.result?.success) return null;

  // Only analyze SELECT results that returned data
  if (!step.result.rows || step.result.rows.length === 0) {
    if (step.result.affectedRows !== undefined) {
      return `✅ ${step.result.affectedRows} row(s) affected in ${step.result.executionTime}ms.`;
    }
    return `✅ Query executed successfully (${step.result.rowCount || 0} rows).`;
  }

  try {
    const messages: LLMChatMessage[] = [
      { role: 'system', content: getAnalysisPrompt(session.schemaContext) },
      {
        role: 'user',
        content: buildAnalysisMessage(
          step.description,
          step.sql || '',
          {
            rowCount: step.result.rowCount,
            affectedRows: step.result.affectedRows,
            preview: step.result.rows?.slice(0, 5),
          }
        ),
      },
    ];

    const { provider, model } = getModelForTier('fast');
    const response = await complete(messages, { provider, model, temperature: 0.1 });
    const parsed = parseJsonResponse(response.content);

    return parsed?.summary || `✅ Returned ${step.result.rowCount} rows.`;
  } catch (err) {
    // Non-critical, just return basic summary
    return `✅ Returned ${step.result.rowCount} rows.`;
  }
}

// ============================================
// WAITING PRIMITIVES (pause agent until user acts)
// ============================================

function waitForApproval(agentSessionId: string): Promise<{ approved: boolean; sql?: string; reason?: string }> {
  return new Promise((resolve, reject) => {
    pendingApprovals.set(agentSessionId, { resolve, reject });
  });
}

function waitForExecutionResult(agentSessionId: string): Promise<AgentExecutionResult> {
  return new Promise((resolve, reject) => {
    pendingExecutions.set(agentSessionId, { resolve, reject });
  });
}

// ============================================
// SSE HELPERS
// ============================================

function sendSSE(agentSessionId: string, event: AgentSSEEvent): void {
  const res = sseConnections.get(agentSessionId);
  if (!res || res.writableEnded) return;

  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch (err) {
    logger.warn(`[AGENT] Failed to send SSE for ${agentSessionId}`);
  }
}

function cleanupSession(agentSessionId: string): void {
  const res = sseConnections.get(agentSessionId);
  if (res && !res.writableEnded) {
    try {
      res.end();
    } catch {}
  }

  sseConnections.delete(agentSessionId);
  pendingApprovals.delete(agentSessionId);
  pendingExecutions.delete(agentSessionId);

  // Keep the session data around for a bit (for history), then clean up
  setTimeout(() => {
    activeSessions.delete(agentSessionId);
  }, 60000); // 1 minute
}

// ============================================
// JSON PARSING HELPER
// ============================================

function parseJsonResponse(text: string): any {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {}

  // Try extracting JSON from markdown code fences
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {}
  }

  // Try finding JSON object in the text
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }

  return null;
}
