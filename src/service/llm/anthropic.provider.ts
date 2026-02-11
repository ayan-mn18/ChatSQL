// ============================================
// ANTHROPIC PROVIDER
// Implements streaming and non-streaming completions
// Uses Claude models for powerful SQL generation
// ============================================

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../utils/logger';
import {
  ILLMProvider,
  LLMProvider,
  LLMConfig,
  LLMResponse,
  ChatMessage,
  StreamCallback,
  TokenUsage,
  MODEL_CONFIG,
} from './types';

const DEFAULT_MODEL = MODEL_CONFIG.anthropic.balanced;

// Model fallback chain for resilience
const MODEL_FALLBACKS = [
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-latest',
  'claude-3-5-sonnet-latest',
];

const FAST_MODEL_FALLBACKS = [
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'claude-3-5-haiku-latest',
  'claude-3-5-haiku-20241022',
];

export class AnthropicProvider implements ILLMProvider {
  readonly name: LLMProvider = 'anthropic';
  private client: Anthropic | null = null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    }
  }

  private isModelNotFoundError(err: unknown): boolean {
    const message = (err as any)?.message ?? String(err);
    return message.includes('404') || message.toLowerCase().includes('not_found');
  }

  private getFallbackChain(requestedModel: string): string[] {
    // Determine if this is a haiku/fast model request
    const isHaiku = requestedModel.toLowerCase().includes('haiku');
    const fallbacks = isHaiku ? FAST_MODEL_FALLBACKS : MODEL_FALLBACKS;
    return [requestedModel, ...fallbacks.filter(m => m !== requestedModel)];
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Extract system prompt from messages and return remaining messages
   */
  private separateSystemPrompt(messages: ChatMessage[]): {
    system: string | undefined;
    userMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  } {
    const systemMessages = messages.filter(m => m.role === 'system');
    const userMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Combine all system messages into one
    const system = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join('\n\n')
      : undefined;

    // Anthropic requires messages to start with 'user' role
    // If first message is 'assistant', prepend a dummy user message
    if (userMessages.length > 0 && userMessages[0].role === 'assistant') {
      userMessages.unshift({ role: 'user', content: 'Continue.' });
    }

    // Anthropic requires alternating user/assistant messages
    // Merge consecutive same-role messages
    const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of userMessages) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
        merged[merged.length - 1].content += '\n\n' + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }

    return { system, userMessages: merged };
  }

  async complete(
    messages: ChatMessage[],
    config?: Partial<LLMConfig>
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized - missing API key');
    }

    const requestedModel = config?.model || DEFAULT_MODEL;
    const modelsToTry = this.getFallbackChain(requestedModel);
    const startTime = Date.now();
    const { system, userMessages } = this.separateSystemPrompt(messages);

    let lastError: unknown;

    for (const model of modelsToTry) {
      try {
        const response = await this.client.messages.create({
          model,
          max_tokens: config?.maxTokens || 4096,
          temperature: config?.temperature ?? 0.7,
          ...(system && { system }),
          messages: userMessages,
        });

        const elapsed = Date.now() - startTime;

        const usage: TokenUsage = {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        };

        const content = response.content
          .filter(block => block.type === 'text')
          .map(block => (block as { type: 'text'; text: string }).text)
          .join('');

        logger.info(
          `[ANTHROPIC] Completed in ${elapsed}ms | Model: ${model} | Tokens: ${usage.totalTokens}`
        );

        return {
          content,
          usage,
          model,
          finishReason: response.stop_reason || undefined,
        };
      } catch (error: any) {
        lastError = error;
        if (!this.isModelNotFoundError(error)) {
          logger.error(`[ANTHROPIC] Completion failed: ${error.message}`);
          throw error;
        }
        logger.warn(`[ANTHROPIC] Model ${model} not available, trying next...`);
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
      callbacks.onError(new Error('Anthropic client not initialized - missing API key'));
      return;
    }

    const requestedModel = config?.model || DEFAULT_MODEL;
    const modelsToTry = this.getFallbackChain(requestedModel);
    const startTime = Date.now();
    const { system, userMessages } = this.separateSystemPrompt(messages);

    for (const model of modelsToTry) {
      try {
        let fullContent = '';
        let inputTokens = 0;
        let outputTokens = 0;

        const stream = this.client.messages.stream({
          model,
          max_tokens: config?.maxTokens || 4096,
          temperature: config?.temperature ?? 0.7,
          ...(system && { system }),
          messages: userMessages,
        });

        stream.on('text', (text) => {
          fullContent += text;
          callbacks.onChunk({
            content: text,
            done: false,
          });
        });

        // Wait for the final message to get usage stats
        const finalMessage = await stream.finalMessage();

        inputTokens = finalMessage.usage.input_tokens;
        outputTokens = finalMessage.usage.output_tokens;

        const elapsed = Date.now() - startTime;
        const usage: TokenUsage = {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        };

        logger.info(
          `[ANTHROPIC] Stream completed in ${elapsed}ms | Model: ${model} | Tokens: ${usage.totalTokens}`
        );

        callbacks.onChunk({ content: '', done: true, usage });
        callbacks.onComplete({
          content: fullContent,
          usage,
          model,
          finishReason: finalMessage.stop_reason || undefined,
        });

        return; // Success, exit loop
      } catch (error: any) {
        if (!this.isModelNotFoundError(error)) {
          logger.error(`[ANTHROPIC] Stream failed: ${error.message}`);
          callbacks.onError(error);
          return;
        }
        logger.warn(`[ANTHROPIC] Model ${model} not available for streaming, trying next...`);
      }
    }

    callbacks.onError(new Error('No available Anthropic models'));
  }
}

// Singleton instance
let instance: AnthropicProvider | null = null;

export function getAnthropicProvider(): AnthropicProvider {
  if (!instance) {
    instance = new AnthropicProvider();
  }
  return instance;
}
