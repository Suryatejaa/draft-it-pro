import type { ProviderSettings } from './types';

const SETTINGS_KEY = 'draftit_ai_credentials_v1';

export const DEFAULT_AI_SETTINGS: ProviderSettings = {
  sarvam: {
    apiKey: '',
    model: 'sarvam-105b',
  },
  openaiCompatible: {
    name: 'Custom Endpoint',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  activeProviderId: 'auto',
  routing: {
    primaryProviderId: 'sarvam',
    primaryModel: 'sarvam-105b',
    fallbacks: [
      { providerId: 'sarvam', model: 'sarvam-30b' },
      { providerId: 'openai-compatible', model: 'gpt-4o-mini' },
    ],
  },
};

export function loadAISettings(): ProviderSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_AI_SETTINGS;
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ProviderSettings>;
    return {
      ...DEFAULT_AI_SETTINGS,
      ...parsed,
      sarvam: {
        ...DEFAULT_AI_SETTINGS.sarvam,
        ...(parsed.sarvam || {}),
      },
      openaiCompatible: {
        ...DEFAULT_AI_SETTINGS.openaiCompatible,
        ...(parsed.openaiCompatible || {}),
      },
      routing: {
        ...DEFAULT_AI_SETTINGS.routing,
        ...(parsed.routing || {}),
      },
    };
  } catch (err) {
    console.error('Failed to load AI settings from storage:', err instanceof Error ? err.message : String(err));
    return DEFAULT_AI_SETTINGS;
  }
}

export function saveAISettings(settings: ProviderSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save AI settings to storage:', err instanceof Error ? err.message : String(err));
  }
}

export function maskApiKey(key: string): string {
  if (!key || key.trim().length === 0) return 'Not configured';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `••••••••${trimmed.slice(-4)}`;
}
