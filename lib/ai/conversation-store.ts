import type { LLMMessage, LLMUsageMetadata, FallbackMetadata } from './types';
import type { ScreenplayAlternatives, ScreenplayProposal } from './screenplay-proposal';

export interface ChatMessage extends LLMMessage {
  id: string;
  timestamp: number;
  elapsedMs?: number;
  usage?: LLMUsageMetadata;
  fallback?: FallbackMetadata;
  contextTag?: string;
  proposal?: ScreenplayProposal;
  alternatives?: ScreenplayAlternatives;
}

const CONVERSATION_KEY_PREFIX = 'draftit_cowriter_chat_v1_';

export function getProjectConversation(projectId: string): ChatMessage[] {
  if (!projectId || typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(`${CONVERSATION_KEY_PREFIX}${projectId}`);
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessage[];
  } catch {
    return [];
  }
}

export function saveProjectConversation(projectId: string, messages: ChatMessage[]): void {
  if (!projectId || typeof window === 'undefined' || !window.localStorage) return;
  try {
    // Keep max 50 recent messages per project conversation to prevent excessive storage
    const trimmed = messages.slice(-50);
    localStorage.setItem(`${CONVERSATION_KEY_PREFIX}${projectId}`, JSON.stringify(trimmed));
  } catch (err) {
    console.error('Failed to save project conversation history:', err);
  }
}

export function clearProjectConversation(projectId: string): void {
  if (!projectId || typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.removeItem(`${CONVERSATION_KEY_PREFIX}${projectId}`);
  } catch {}
}
