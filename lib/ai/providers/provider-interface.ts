import type {
  LLMProviderId,
  ModelInfo,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
} from '../types';

export interface LLMProvider {
  id: LLMProviderId;
  displayName: string;

  generate(request: LLMRequest, model: string): Promise<LLMResponse>;
  stream?(
    request: LLMRequest,
    model: string,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<LLMResponse>;
  validateCredentials?(apiKey: string, model?: string, baseUrl?: string): Promise<boolean>;
  listModels?(): ModelInfo[];
}
