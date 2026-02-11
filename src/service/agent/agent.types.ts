// ============================================
// AGENT MODE TYPES
// Defines the agent loop: plan → propose → approve → execute → iterate
// ============================================

export type AgentSessionStatus =
  | 'planning'         // AI is generating a plan
  | 'proposing'        // AI proposed a query, waiting for user approval
  | 'executing'        // Query is being executed
  | 'analyzing'        // AI is analyzing execution results
  | 'error_recovery'   // AI is fixing an error
  | 'completed'        // Task completed successfully
  | 'stopped'          // User stopped the agent
  | 'failed';          // Unrecoverable failure

export interface AgentStep {
  id: number;
  description: string;
  sql?: string;
  status: 'pending' | 'active' | 'approved' | 'executed' | 'failed' | 'skipped';
  result?: AgentExecutionResult;
  error?: string;
  retryCount: number;
}

export interface AgentExecutionResult {
  success: boolean;
  rows?: any[];
  rowCount?: number;
  affectedRows?: number;
  executionTime?: number;
  error?: string;
  errorDetails?: {
    message: string;
    detail?: string;
    hint?: string;
    position?: number;
  };
}

export interface AgentSession {
  id: string;
  connectionId: string;
  userId: string;
  sessionId: string;          // chat session ID
  originalMessage: string;
  schemaContext: string;
  selectedSchemas: string[];
  status: AgentSessionStatus;
  plan: AgentStep[];
  currentStepIndex: number;
  maxRetries: number;
  totalRetries: number;
  createdAt: Date;
}

// ============================================
// SSE EVENT TYPES (backend → frontend)
// ============================================

export interface AgentPlanEvent {
  type: 'agent_plan';
  sessionId: string;
  plan: Array<{ id: number; description: string }>;
  message: string;  // AI's plan explanation
}

export interface AgentThinkingEvent {
  type: 'agent_thinking';
  sessionId: string;
  message: string;
}

export interface AgentProposalEvent {
  type: 'agent_proposal';
  sessionId: string;
  stepIndex: number;
  stepDescription: string;
  sql: string;
  explanation: string;
  isRetry: boolean;
  retryCount: number;
}

export interface AgentExecutingEvent {
  type: 'agent_executing';
  sessionId: string;
  stepIndex: number;
  sql: string;
}

export interface AgentResultEvent {
  type: 'agent_result';
  sessionId: string;
  stepIndex: number;
  success: boolean;
  rowCount?: number;
  affectedRows?: number;
  executionTime?: number;
  preview?: any[];  // first few rows
  error?: string;
  errorDetails?: {
    message: string;
    detail?: string;
    hint?: string;
  };
}

export interface AgentCompleteEvent {
  type: 'agent_complete';
  sessionId: string;
  summary: string;
  stepsCompleted: number;
  totalSteps: number;
}

export interface AgentErrorEvent {
  type: 'agent_error';
  sessionId: string;
  error: string;
  recoverable: boolean;
}

export interface AgentStoppedEvent {
  type: 'agent_stopped';
  sessionId: string;
  message: string;
}

export interface AgentContentEvent {
  type: 'content';
  content: string;
}

export type AgentSSEEvent =
  | AgentPlanEvent
  | AgentThinkingEvent
  | AgentProposalEvent
  | AgentExecutingEvent
  | AgentResultEvent
  | AgentCompleteEvent
  | AgentErrorEvent
  | AgentStoppedEvent
  | AgentContentEvent;

// ============================================
// REQUEST/RESPONSE TYPES
// ============================================

export interface AgentStartRequest {
  message: string;
  sessionId?: string;
  selectedSchemas?: string[];
}

export interface AgentApproveRequest {
  /** If user edits the SQL before approving */
  modifiedSql?: string;
}

export interface AgentFeedbackRequest {
  /** The execution result from the frontend */
  result: AgentExecutionResult;
}

export interface AgentRejectRequest {
  /** Optional feedback for why they rejected */
  reason?: string;
}
