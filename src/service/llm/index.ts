// ============================================
// LLM PROVIDER FACTORY
// Unified entry point for all LLM operations
// ============================================

import { logger } from '../../utils/logger';
import {
  ILLMProvider,
  LLMProvider,
  LLMConfig,
  LLMResponse,
  ChatMessage,
  StreamCallback,
  ModelTier,
  MODEL_CONFIG,
  TIER_PROVIDER_PREFERENCE,
} from './types';
import { getOpenAIProvider } from './openai.provider';
import { getGeminiProvider } from './gemini.provider';
import { getAnthropicProvider } from './anthropic.provider';

// Re-export types for convenience
export * from './types';

// Default provider preference order (general fallback)
const PROVIDER_PREFERENCE: LLMProvider[] = ['gemini', 'anthropic', 'openai'];

// Provider registry
const providers: Map<LLMProvider, ILLMProvider> = new Map();

function initializeProviders(): void {
  if (providers.size > 0) return;

  const gemini = getGeminiProvider();
  const openai = getOpenAIProvider();
  const anthropic = getAnthropicProvider();

  if (gemini.isAvailable()) {
    providers.set('gemini', gemini);
    logger.info('[LLM] Gemini provider initialized');
  }

  if (anthropic.isAvailable()) {
    providers.set('anthropic', anthropic);
    logger.info('[LLM] Anthropic provider initialized');
  }

  if (openai.isAvailable()) {
    providers.set('openai', openai);
    logger.info('[LLM] OpenAI provider initialized');
  }

  if (providers.size === 0) {
    logger.warn('[LLM] No LLM providers available! Check API keys.');
  } else {
    logger.info(`[LLM] ${providers.size} provider(s) ready: ${Array.from(providers.keys()).join(', ')}`);
  }
}

/**
 * Get a specific provider by name
 */
export function getProvider(name: LLMProvider): ILLMProvider | undefined {
  initializeProviders();
  return providers.get(name);
}

/**
 * Get the best available provider based on preference
 */
export function getBestProvider(): ILLMProvider {
  initializeProviders();

  for (const name of PROVIDER_PREFERENCE) {
    const provider = providers.get(name);
    if (provider?.isAvailable()) {
      return provider;
    }
  }

  throw new Error('No LLM providers available');
}

/**
 * Get model name for a specific tier and provider.
 * Uses smart tier-based provider selection:
 * - fast tier → prefers Gemini (cheapest, fastest)
 * - balanced/powerful tier → prefers Anthropic (best SQL quality)
 */
export function getModelForTier(
  tier: ModelTier,
  provider?: LLMProvider
): { provider: LLMProvider; model: string } {
  initializeProviders();

  let targetProvider: LLMProvider | undefined;

  if (provider) {
    // Explicit provider requested
    targetProvider = providers.get(provider)?.isAvailable() ? provider : undefined;
  }

  if (!targetProvider) {
    // Use tier-specific provider preference
    const tierPreference = TIER_PROVIDER_PREFERENCE[tier] || PROVIDER_PREFERENCE;
    targetProvider = tierPreference.find(p => providers.get(p)?.isAvailable());
  }

  if (!targetProvider) {
    // Final fallback: any available provider
    targetProvider = PROVIDER_PREFERENCE.find(p => providers.get(p)?.isAvailable());
  }
  
  if (!targetProvider) {
    throw new Error('No LLM providers available');
  }

  const model = MODEL_CONFIG[targetProvider][tier];
  logger.debug(`[LLM] Tier '${tier}' → provider '${targetProvider}' → model '${model}'`);

  return {
    provider: targetProvider,
    model,
  };
}

/**
 * Simple completion (non-streaming)
 * Automatically selects best available provider
 */
export async function complete(
  messages: ChatMessage[],
  config?: Partial<LLMConfig>
): Promise<LLMResponse> {
  const provider = config?.provider ? getProvider(config.provider) : getBestProvider();
  
  if (!provider) {
    throw new Error(`Provider ${config?.provider} not available`);
  }

  return provider.complete(messages, config);
}

/**
 * Streaming completion
 * Automatically selects best available provider
 */
export async function stream(
  messages: ChatMessage[],
  callbacks: StreamCallback,
  config?: Partial<LLMConfig>
): Promise<void> {
  const provider = config?.provider ? getProvider(config.provider) : getBestProvider();
  
  if (!provider) {
    callbacks.onError(new Error(`Provider ${config?.provider} not available`));
    return;
  }

  return provider.stream(messages, callbacks, config);
}

/**
 * Quick completion with a single prompt (non-streaming)
 * Useful for simple tasks like intent classification
 */
export async function quickComplete(
  prompt: string,
  options?: {
    tier?: ModelTier;
    provider?: LLMProvider;
    systemPrompt?: string;
    temperature?: number;
  }
): Promise<string> {
  const { tier = 'fast', provider, systemPrompt, temperature } = options || {};
  const { provider: resolvedProvider, model } = getModelForTier(tier, provider);

  const messages: ChatMessage[] = [];
  
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  
  messages.push({ role: 'user', content: prompt });

  const response = await complete(messages, {
    provider: resolvedProvider,
    model,
    temperature,
  });

  return response.content;
}

/**
 * Check which providers are available
 */
export function getAvailableProviders(): LLMProvider[] {
  initializeProviders();
  return Array.from(providers.entries())
    .filter(([_, provider]) => provider.isAvailable())
    .map(([name]) => name);
}
