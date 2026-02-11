// ============================================
// LLM PROVIDER TYPES
// Unified interface for all LLM providers
// ============================================

export type LLMProvider = 'openai' | 'gemini' | 'anthropic';

export type ModelTier = 'fast' | 'balanced' | 'powerful';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  finishReason?: string;
}

export interface StreamCallback {
  onChunk: (chunk: StreamChunk) => void;
  onError: (error: Error) => void;
  onComplete: (response: LLMResponse) => void;
}

// Provider interface - all providers must implement this
export interface ILLMProvider {
  readonly name: LLMProvider;
  
  // Non-streaming completion
  complete(messages: ChatMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse>;
  
  // Streaming completion
  stream(
    messages: ChatMessage[],
    callbacks: StreamCallback,
    config?: Partial<LLMConfig>
  ): Promise<void>;
  
  // Check if provider is available
  isAvailable(): boolean;
}

// Model configurations for different tiers
export const MODEL_CONFIG: Record<LLMProvider, Record<ModelTier, string>> = {
  openai: {
    fast: 'gpt-4o-mini',                    // Cheap, fast - for intent detection
    balanced: 'gpt-4o',                      // Good balance
    powerful: 'gpt-4o',                      // Most capable
  },
  gemini: {
    fast: 'gemini-2.0-flash',               // Cheap, fast
    balanced: 'gemini-1.5-flash',            // Good balance
    powerful: 'gemini-1.5-pro',              // Most capable
  },
  anthropic: {
    fast: 'claude-haiku-4-5-20251001',        // Fast, cheap
    balanced: 'claude-sonnet-4-5-20250929',   // Strong SQL generation
    powerful: 'claude-sonnet-4-5-20250929',   // Best for complex SQL & agent tasks
  },
};

/**
 * Smart tier-to-provider mapping.
 * Different tiers can prefer different providers for optimal cost/quality.
 * - fast: Use Gemini (cheapest, fastest for intent classification & casual chat)
 * - balanced: Use Anthropic if available (best SQL generation quality)
 * - powerful: Use Anthropic if available (best for complex reasoning & agent tasks)
 */
export const TIER_PROVIDER_PREFERENCE: Record<ModelTier, LLMProvider[]> = {
  fast: ['gemini', 'openai', 'anthropic'],       // Cheapest first
  balanced: ['anthropic', 'openai', 'gemini'],   // Best quality first
  powerful: ['anthropic', 'openai', 'gemini'],   // Best reasoning first
};
