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
    fast: 'gpt-4o-mini',        // Cheap, fast - for intent detection
    balanced: 'gpt-4o',          // Good balance
    powerful: 'gpt-4-turbo',     // Most capable
  },
  gemini: {
    fast: 'gemini-2.0-flash',    // Cheap, fast
    balanced: 'gemini-1.5-flash', // Good balance
    powerful: 'gemini-1.5-pro',   // Most capable
  },
  anthropic: {
    fast: 'claude-3-haiku-20240307',     // Cheap, fast
    balanced: 'claude-3-5-sonnet-20241022', // Good balance
    powerful: 'claude-3-opus-20240229',    // Most capable
  },
};
