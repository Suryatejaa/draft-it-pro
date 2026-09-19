export type LLMProviderId = 'sarvam' | 'openai-compatible' | 'openai' | 'anthropic' | 'gemini';

export type LLMFailureType =
  | 'timeout'
  | 'rate_limit'
  | 'capacity'
  | 'server_error'
  | 'model_unavailable'
  | 'context_limit'
  | 'authentication'
  | 'invalid_request'
  | 'safety'
  | 'cancelled'
  | 'unknown';

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: any;
  error?: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | null;
  tools?: ToolDefinition[];
  abortSignal?: AbortSignal;
  diagnostics?: {
    requestId: string;
    intent?: string;
    sourceBlocks?: Array<{ id: string; type: string; text: string }>;
    retryAttempt?: number;
    uiConversationMessageCount?: number;
  };
}

export interface LLMUsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
}

export interface FallbackMetadata {
  requestedProviderId: LLMProviderId;
  requestedModel: string;
  usedProviderId: LLMProviderId;
  usedModel: string;
  fallbackReason?: string;
  attemptedProviders?: Array<{
    providerId: LLMProviderId;
    model: string;
    failureType: LLMFailureType;
    error: string;
  }>;
}

export interface LLMResponse {
  content: string;
  providerId: LLMProviderId;
  model: string;
  toolCalls?: ToolCall[];
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error' | 'cancelled';
  usage?: LLMUsageMetadata;
  fallback?: FallbackMetadata;
  reasoningContent?: string;
}

export interface LLMStreamChunk {
  type: 'content' | 'tool_call' | 'usage' | 'finish' | 'reset';
  content?: string;
  toolCallDelta?: Partial<ToolCall>;
  finishReason?: string;
  usage?: LLMUsageMetadata;
}

export interface SarvamSettings {
  apiKey: string;
  model: string;
}

export interface OpenAICompatibleSettings {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ProviderSettings {
  sarvam: SarvamSettings;
  openaiCompatible: OpenAICompatibleSettings;
  activeProviderId: LLMProviderId | 'auto';
  selectedModel?: string;
  routing: {
    primaryProviderId: LLMProviderId;
    primaryModel: string;
    fallbacks: Array<{
      providerId: LLMProviderId;
      model: string;
    }>;
  };
}
