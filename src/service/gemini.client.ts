import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { GOOGLE_AI_MODEL } from '../config/env';

type GenerateContentRequest = Parameters<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['generateContent']>[0];

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

export async function generateGeminiText(request: GenerateContentRequest): Promise<string> {
  const result = await generateGeminiContent(request);
  return result?.response?.text?.() || '';
}
