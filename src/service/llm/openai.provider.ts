// ============================================
// OPENAI PROVIDER
// Implements streaming and non-streaming completions
// ============================================

import OpenAI from 'openai';
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

const DEFAULT_MODEL = MODEL_CONFIG.openai.balanced;

export class OpenAIProvider implements ILLMProvider {
  readonly name: LLMProvider = 'openai';
  private client: OpenAI | null = null;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async complete(
    messages: ChatMessage[],
    config?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized - missing API key');
    }

    const model = config?.model || DEFAULT_MODEL;
    const startTime = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: config?.temperature ?? 0.7,
        max_tokens: config?.maxTokens,
      });

      const elapsed = Date.now() - startTime;
      const usage: TokenUsage = {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      };

      logger.info(
        `[OPENAI] Completed in ${elapsed}ms | Model: ${model} | Tokens: ${usage.totalTokens}`
      );

      return {
        content: response.choices[0]?.message?.content || '',
        usage,
        model,
        finishReason: response.choices[0]?.finish_reason || undefined,
      };
    } catch (error: any) {
      logger.error(`[OPENAI] Completion failed: ${error.message}`);
      throw error;
    }
  }

  async stream(
    messages: ChatMessage[],
    callbacks: StreamCallback,
    config?: Partial<LLMConfig>
  ): Promise<void> {
    if (!this.client) {
      callbacks.onError(new Error('OpenAI client not initialized - missing API key'));
      return;
    }

    const model = config?.model || DEFAULT_MODEL;
    const startTime = Date.now();
    let fullContent = '';
    let inputTokens = 0;

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: config?.temperature ?? 0.7,
        max_tokens: config?.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        
        if (delta) {
          fullContent += delta;
          callbacks.onChunk({
            content: delta,
            done: false,
          });
        }

        // Capture usage from final chunk
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || 0;
        }

        if (chunk.choices[0]?.finish_reason) {
          const elapsed = Date.now() - startTime;
          const outputTokens = Math.ceil(fullContent.length / 4); // Approximate
          
          const usage: TokenUsage = {
            inputTokens,
            outputTokens: chunk.usage?.completion_tokens || outputTokens,
            totalTokens: chunk.usage?.total_tokens || (inputTokens + outputTokens),
          };

          logger.info(
            `[OPENAI] Stream completed in ${elapsed}ms | Model: ${model} | Tokens: ${usage.totalTokens}`
          );

          callbacks.onChunk({ content: '', done: true, usage });
          callbacks.onComplete({
            content: fullContent,
            usage,
            model,
            finishReason: chunk.choices[0].finish_reason,
          });
        }
      }
    } catch (error: any) {
      logger.error(`[OPENAI] Stream failed: ${error.message}`);
      callbacks.onError(error);
    }
  }
}

// Singleton instance
let instance: OpenAIProvider | null = null;

export function getOpenAIProvider(): OpenAIProvider {
  if (!instance) {
    instance = new OpenAIProvider();
  }
  return instance;
}
