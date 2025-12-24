import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { GOOGLE_AI_MODEL } from '../config/env';

type GenerateContentRequest = Parameters<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['generateContent']>[0];

// Token usage metadata from Gemini response
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Extended response with token tracking
export interface GeminiResponse {
  text: string;
  tokenUsage: TokenUsage;
  model: string;
  cached: boolean;
}

function isModelUnsupportedError(err: unknown): boolean {
  const message = (err as any)?.message ?? String(err);
  return (
    message.includes('404') ||
    message.toLowerCase().includes('not found') ||
    message.toLowerCase().includes('not supported for generatecontent') ||
    message.toLowerCase().includes('is not found for api version')
  );
}

function uniqueStrings(items: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item) continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// Preference order: env model first, then common "latest" fallbacks known to work with v1beta generateContent.
// If Google rejects one, we automatically try the next.
const MODEL_FALLBACKS = uniqueStrings([
  GOOGLE_AI_MODEL,
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
]);

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');

let activeModelName = MODEL_FALLBACKS[0] || 'gemini-1.5-flash';

function getModel(modelName: string) {
  return genAI.getGenerativeModel({ model: modelName });
}

// Extract token usage from Gemini response
function extractTokenUsage(response: any): TokenUsage {
  try {
    const usageMetadata = response?.response?.usageMetadata;
    if (usageMetadata) {
      return {
        inputTokens: usageMetadata.promptTokenCount || 0,
        outputTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
      };
    }
  } catch (err) {
    logger.warn('[GEMINI] Failed to extract token usage:', err);
  }
  
  // Fallback: estimate tokens (rough approximation: ~4 chars per token)
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

export function getActiveModelName(): string {
  return activeModelName;
}

export async function generateGeminiContent(request: GenerateContentRequest) {
  let lastError: unknown;

  for (const candidate of MODEL_FALLBACKS) {
    try {
      if (candidate !== activeModelName) {
        logger.warn(`[GEMINI] Falling back model: ${activeModelName} -> ${candidate}`);
        activeModelName = candidate;
      }

      const model = getModel(candidate);
      return await model.generateContent(request);
    } catch (err) {
      lastError = err;
      if (!isModelUnsupportedError(err)) {
        throw err;
      }

      const message = (err as any)?.message ?? String(err);
      logger.warn(`[GEMINI] Model ${candidate} rejected (${message}). Trying next...`);
    }
  }

  throw lastError;
}

// Original text-only function (kept for backward compatibility)
export async function generateGeminiText(request: GenerateContentRequest): Promise<string> {
  const result = await generateGeminiContent(request);
  return result?.response?.text?.() || '';
}

// New function that returns text with token usage
export async function generateGeminiTextWithUsage(request: GenerateContentRequest): Promise<GeminiResponse> {
  const startTime = Date.now();
  const result = await generateGeminiContent(request);
  const elapsed = Date.now() - startTime;
  
  const text = result?.response?.text?.() || '';
  const tokenUsage = extractTokenUsage(result);
  
  logger.info(`[GEMINI] Generated response in ${elapsed}ms | Tokens: ${tokenUsage.totalTokens} (in: ${tokenUsage.inputTokens}, out: ${tokenUsage.outputTokens}) | Model: ${activeModelName}`);
  
  return {
    text,
    tokenUsage,
    model: activeModelName,
    cached: false,
  };
}
