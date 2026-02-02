// ============================================
// GEMINI PROVIDER
// Implements streaming and non-streaming completions
// ============================================

import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../../utils/logger';
import {
  ILLMProvider,
  LLMProvider,
  LLMConfig,
  LLMResponse,
  ChatMessage,
  StreamCallback,
  StreamChunk,
  TokenUsage,
  MODEL_CONFIG,
} from './types';

const DEFAULT_MODEL = MODEL_CONFIG.gemini.fast;

// Model fallback chain for resilience
const MODEL_FALLBACKS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
];

export class GeminiProvider implements ILLMProvider {
  readonly name: LLMProvider = 'gemini';
  private client: GoogleGenerativeAI | null = null;
  private activeModel: string = DEFAULT_MODEL;

  constructor() {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (apiKey) {
      this.client = new GoogleGenerativeAI(apiKey);
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  private getModel(modelName: string) {
    if (!this.client) throw new Error('Gemini client not initialized');
    return this.client.getGenerativeModel({ model: modelName });
  }

  private isModelUnsupportedError(err: unknown): boolean {
    const message = (err as any)?.message ?? String(err);
    return (
      message.includes('404') ||
      message.toLowerCase().includes('not found') ||
      message.toLowerCase().includes('not supported')
    );
  }

  private convertToChatHistory(messages: ChatMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
    // Gemini expects 'user' and 'model' roles
    return messages
      .filter(m => m.role !== 'system') // System message handled separately
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
  }

  private getSystemInstruction(messages: ChatMessage[]): { role: string; parts: Array<{ text: string }> } | undefined {
    const systemMsg = messages.find(m => m.role === 'system');
    if (!systemMsg) return undefined;
    
    // Gemini requires systemInstruction as a Content object
    return {
      role: 'user',
      parts: [{ text: systemMsg.content }],
    };
  }

  async complete(
    messages: ChatMessage[],
    config?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Gemini client not initialized - missing API key');
    }

    const requestedModel = config?.model || DEFAULT_MODEL;
    const modelsToTry = [requestedModel, ...MODEL_FALLBACKS.filter(m => m !== requestedModel)];
    const startTime = Date.now();

    let lastError: unknown;

    for (const modelName of modelsToTry) {
      try {
        const model = this.getModel(modelName);
        const systemInstruction = this.getSystemInstruction(messages);
        const history = this.convertToChatHistory(messages);
        
        // Get the last user message
        const lastMessage = history.pop();
        if (!lastMessage) throw new Error('No user message provided');

        const chat = model.startChat({
          history,
          ...(systemInstruction && { systemInstruction }),
        });

        const result = await chat.sendMessage(lastMessage.parts[0].text);
        const response = result.response;
        
        const elapsed = Date.now() - startTime;
        const usageMetadata = response.usageMetadata;
        
        const usage: TokenUsage = {
          inputTokens: usageMetadata?.promptTokenCount || 0,
          outputTokens: usageMetadata?.candidatesTokenCount || 0,
          totalTokens: usageMetadata?.totalTokenCount || 0,
        };

        this.activeModel = modelName;
        
        logger.info(
          `[GEMINI] Completed in ${elapsed}ms | Model: ${modelName} | Tokens: ${usage.totalTokens}`
        );

        return {
          content: response.text() || '',
          usage,
          model: modelName,
          finishReason: response.candidates?.[0]?.finishReason || undefined,
        };
      } catch (error) {
        lastError = error;
        if (!this.isModelUnsupportedError(error)) {
          throw error;
        }
        logger.warn(`[GEMINI] Model ${modelName} not available, trying next...`);
      }
    }

    throw lastError;
  }

  async stream(
    messages: ChatMessage[],
    callbacks: StreamCallback,
    config?: Partial<LLMConfig>
  ): Promise<void> {
    if (!this.client) {
      callbacks.onError(new Error('Gemini client not initialized - missing API key'));
      return;
    }

    const requestedModel = config?.model || DEFAULT_MODEL;
    const modelsToTry = [requestedModel, ...MODEL_FALLBACKS.filter(m => m !== requestedModel)];
    const startTime = Date.now();

    for (const modelName of modelsToTry) {
      try {
        const model = this.getModel(modelName);
        const systemInstruction = this.getSystemInstruction(messages);
        const history = this.convertToChatHistory(messages);
        
        const lastMessage = history.pop();
        if (!lastMessage) {
          callbacks.onError(new Error('No user message provided'));
          return;
        }

        const chat = model.startChat({
          history,
          ...(systemInstruction && { systemInstruction }),
        });

        const result = await chat.sendMessageStream(lastMessage.parts[0].text);
        let fullContent = '';

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            fullContent += text;
            callbacks.onChunk({
              content: text,
              done: false,
            });
          }
        }

        // Get final response for usage stats
        const response = await result.response;
        const elapsed = Date.now() - startTime;
        const usageMetadata = response.usageMetadata;

        const usage: TokenUsage = {
          inputTokens: usageMetadata?.promptTokenCount || 0,
          outputTokens: usageMetadata?.candidatesTokenCount || 0,
          totalTokens: usageMetadata?.totalTokenCount || 0,
        };

        this.activeModel = modelName;

        logger.info(
          `[GEMINI] Stream completed in ${elapsed}ms | Model: ${modelName} | Tokens: ${usage.totalTokens}`
        );

        callbacks.onChunk({ content: '', done: true, usage });
        callbacks.onComplete({
          content: fullContent,
          usage,
          model: modelName,
          finishReason: response.candidates?.[0]?.finishReason || undefined,
        });

        return; // Success, exit loop
      } catch (error: any) {
        if (!this.isModelUnsupportedError(error)) {
          logger.error(`[GEMINI] Stream failed: ${error.message}`);
          callbacks.onError(error);
          return;
        }
        logger.warn(`[GEMINI] Model ${modelName} not available for streaming, trying next...`);
      }
    }

    callbacks.onError(new Error('No available Gemini models'));
  }
}

// Singleton instance
let instance: GeminiProvider | null = null;

export function getGeminiProvider(): GeminiProvider {
  if (!instance) {
    instance = new GeminiProvider();
  }
  return instance;
}
