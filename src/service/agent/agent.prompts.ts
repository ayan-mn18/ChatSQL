// ============================================
// AGENT MODE PROMPTS
// Specialized prompts for planning, SQL generation, and error recovery
// ============================================

/**
 * System prompt for the planning phase.
 * The agent breaks down the user's request into executable steps.
 */
export function getPlanningPrompt(schemaContext: string): string {
  return `You are an expert database agent. The user will describe what they want to accomplish with their database.
Your job is to create a step-by-step plan of SQL queries to achieve their goal.

DATABASE SCHEMA:
${schemaContext}

RULES:
1. Break the task into the MINIMUM number of SQL steps needed (usually 1-3)
2. Each step must be a single SQL statement
3. Order steps logically (e.g., create table before inserting data)
4. For simple requests (single SELECT/INSERT/UPDATE/DELETE), use just ONE step
5. Consider dependencies between steps

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "plan": [
    { "id": 1, "description": "Brief description of what this step does", "sql": "SELECT ..." },
    { "id": 2, "description": "Brief description", "sql": "INSERT INTO ..." }
  ],
  "explanation": "One sentence explaining the overall approach"
}

IMPORTANT:
- Use ONLY tables and columns that exist in the schema above
- Use proper PostgreSQL syntax
- For SELECT queries, be specific with columns (avoid SELECT * unless the user asked for it)
- If the user's request is unclear, create a plan with a single exploratory query`;
}

/**
 * System prompt for the error recovery phase.
 * The agent analyzes an error and generates a fixed query.
 */
export function getErrorRecoveryPrompt(schemaContext: string): string {
  return `You are an expert database agent fixing a SQL error.

DATABASE SCHEMA:
${schemaContext}

A SQL query failed during execution. Analyze the error and generate a corrected query.

RULES:
1. Focus on the specific error message — fix exactly what went wrong
2. Common fixes: wrong table/column names, missing quotes, type mismatches, syntax errors
3. Use ONLY tables and columns from the schema above
4. Keep the corrected query as close to the original intent as possible

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "sql": "CORRECTED SQL HERE",
  "explanation": "Brief explanation of what was wrong and how you fixed it"
}`;
}

/**
 * System prompt for analyzing query results and deciding next steps.
 */
export function getAnalysisPrompt(schemaContext: string): string {
  return `You are an expert database agent analyzing query results.

DATABASE SCHEMA:
${schemaContext}

A query was executed successfully. Analyze the results and provide a brief summary.

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "summary": "Brief, human-readable summary of the results (1-2 sentences)",
  "needsFollowUp": false
}

Keep the summary concise and focused on the data returned.`;
}

/**
 * Build the user message for planning
 */
export function buildPlanningUserMessage(
  userMessage: string,
  chatHistory?: Array<{ role: string; content: string }>
): string {
  let prompt = '';

  if (chatHistory && chatHistory.length > 0) {
    const recent = chatHistory.slice(-4);
    prompt += 'Recent conversation context:\n';
    for (const msg of recent) {
      prompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 300)}\n`;
    }
    prompt += '\n';
  }

  prompt += `User request: ${userMessage}`;
  return prompt;
}

/**
 * Build the user message for error recovery
 */
export function buildErrorRecoveryMessage(
  originalSql: string,
  error: string,
  errorDetails?: { message: string; detail?: string; hint?: string },
  retryCount: number = 0
): string {
  let prompt = `Original SQL that failed:\n\`\`\`sql\n${originalSql}\n\`\`\`\n\n`;
  prompt += `Error: ${error}\n`;

  if (errorDetails) {
    if (errorDetails.detail) prompt += `Detail: ${errorDetails.detail}\n`;
    if (errorDetails.hint) prompt += `Hint: ${errorDetails.hint}\n`;
  }

  if (retryCount > 0) {
    prompt += `\nThis is retry attempt #${retryCount}. Try a different approach if the same fix didn't work.`;
  }

  return prompt;
}

/**
 * Build the user message for result analysis
 */
export function buildAnalysisMessage(
  stepDescription: string,
  sql: string,
  result: { rowCount?: number; affectedRows?: number; preview?: any[] }
): string {
  let prompt = `Step: ${stepDescription}\n`;
  prompt += `SQL executed: ${sql}\n`;

  if (result.rowCount !== undefined) {
    prompt += `Rows returned: ${result.rowCount}\n`;
  }
  if (result.affectedRows !== undefined) {
    prompt += `Rows affected: ${result.affectedRows}\n`;
  }
  if (result.preview && result.preview.length > 0) {
    prompt += `Sample data (first ${result.preview.length} rows):\n`;
    prompt += JSON.stringify(result.preview.slice(0, 5), null, 2);
  }

  return prompt;
}
