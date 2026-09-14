'use client';

import { useState } from 'react';
import {
  loadAISettings,
  saveAISettings,
  maskApiKey,
  DEFAULT_AI_SETTINGS,
} from '@/lib/ai/credentials';
import type { ProviderSettings, LLMProviderId } from '@/lib/ai/types';
import { SarvamProvider } from '@/lib/ai/providers/sarvam-provider';
import { OpenAICompatibleProvider } from '@/lib/ai/providers/openai-compatible-provider';
import { Key, Server, Cpu, CheckCircle2, XCircle, Loader2, ShieldCheck } from 'lucide-react';

interface AIProviderSettingsProps {
  onClose?: () => void;
}

export function AIProviderSettings({ onClose }: AIProviderSettingsProps) {
  const [settings, setSettings] = useState<ProviderSettings>(() => loadAISettings());
  const [sarvamTestStatus, setSarvamTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [openaiTestStatus, setOpenaiTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = () => {
    saveAISettings(settings);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleTestSarvam = async () => {
    setSarvamTestStatus('testing');
    setTestMessage('');
    try {
      const provider = new SarvamProvider(settings.sarvam.apiKey);
      const valid = await provider.validateCredentials(settings.sarvam.apiKey, settings.sarvam.model);
      if (valid) {
        setSarvamTestStatus('success');
      } else {
        setSarvamTestStatus('failed');
        setTestMessage('Invalid API key or unauthorized response from Sarvam AI.');
      }
    } catch (err: any) {
      setSarvamTestStatus('failed');
      setTestMessage(err.message || 'Connection test failed');
    }
  };

  const handleTestOpenAI = async () => {
    setOpenaiTestStatus('testing');
    setTestMessage('');
    try {
      const provider = new OpenAICompatibleProvider(
        settings.openaiCompatible.name,
        settings.openaiCompatible.apiKey,
        settings.openaiCompatible.baseUrl
      );
      const valid = await provider.validateCredentials(
        settings.openaiCompatible.apiKey,
        settings.openaiCompatible.model,
        settings.openaiCompatible.baseUrl
      );
      if (valid) {
        setOpenaiTestStatus('success');
      } else {
        setOpenaiTestStatus('failed');
        setTestMessage('Invalid API key or invalid response from OpenAI-compatible endpoint.');
      }
    } catch (err: any) {
      setOpenaiTestStatus('failed');
      setTestMessage(err.message || 'Connection test failed');
    }
  };

  return (
    <div className="space-y-6 p-1 text-sm text-foreground">
      <div className="flex items-center justify-between border-b border-border/40 pb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            Co-Drafter AI · Providers & Credentials (BYOK)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure your own LLM API keys. Keys are stored locally on your device and are never sent to Draft-it servers or saved in project files.
          </p>
        </div>
      </div>

      <div className="bg-muted/30 border border-border/50 rounded-lg p-3 flex items-start gap-2.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
        <div>
          <strong className="text-foreground font-medium">Privacy Guaranteed:</strong> API keys are strictly kept in browser local storage. They are never written to project snapshots, backup files, Firebase, or exported scripts.
        </div>
      </div>

      {/* Sarvam AI Section */}
      <div className="border border-border/60 rounded-xl p-4 space-y-3.5 bg-card/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-amber-500" />
            <h3 className="font-medium text-foreground">Sarvam AI (Default Provider)</h3>
          </div>
          <span className="text-[11px] bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono px-2 py-0.5 rounded-full border border-amber-500/20">
            Recommended
          </span>
        </div>

        <div className="grid gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">API Key</label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="Enter Sarvam API Key"
                value={settings.sarvam.apiKey}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    sarvam: { ...settings.sarvam, apiKey: e.target.value },
                  })
                }
                className="flex-1 bg-background border border-input rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={handleTestSarvam}
                disabled={sarvamTestStatus === 'testing' || !settings.sarvam.apiKey}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-muted hover:bg-muted/80 border border-border disabled:opacity-50 flex items-center gap-1.5 shrink-0"
              >
                {sarvamTestStatus === 'testing' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : sarvamTestStatus === 'success' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : sarvamTestStatus === 'failed' ? (
                  <XCircle className="h-3.5 w-3.5 text-rose-500" />
                ) : null}
                Test Connection
              </button>
            </div>
            {settings.sarvam.apiKey && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Masked Key: <span className="font-mono">{maskApiKey(settings.sarvam.apiKey)}</span>
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Default Model</label>
            <select
              value={settings.sarvam.model}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  sarvam: { ...settings.sarvam, model: e.target.value },
                })
              }
              className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="sarvam-105b">Sarvam 105B (Primary)</option>
              <option value="sarvam-30b">Sarvam 30B (Faster / Fallback)</option>
              <option value="sarvam-2b">Sarvam 2B (Lightweight)</option>
            </select>
          </div>
        </div>
      </div>

      {/* OpenAI Compatible Section */}
      <div className="border border-border/60 rounded-xl p-4 space-y-3.5 bg-card/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-sky-500" />
            <h3 className="font-medium text-foreground">OpenAI-Compatible Endpoint</h3>
          </div>
          <span className="text-[11px] bg-sky-500/10 text-sky-600 dark:text-sky-400 font-mono px-2 py-0.5 rounded-full border border-sky-500/20">
            External / Self-hosted
          </span>
        </div>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Provider Label</label>
              <input
                type="text"
                placeholder="Custom LLM"
                value={settings.openaiCompatible.name}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    openaiCompatible: { ...settings.openaiCompatible, name: e.target.value },
                  })
                }
                className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Model Name</label>
              <input
                type="text"
                placeholder="gpt-4o-mini"
                value={settings.openaiCompatible.model}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    openaiCompatible: { ...settings.openaiCompatible, model: e.target.value },
                  })
                }
                className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Base URL</label>
            <input
              type="text"
              placeholder="https://api.openai.com/v1"
              value={settings.openaiCompatible.baseUrl}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  openaiCompatible: { ...settings.openaiCompatible, baseUrl: e.target.value },
                })
              }
              className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">API Key</label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="sk-..."
                value={settings.openaiCompatible.apiKey}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    openaiCompatible: { ...settings.openaiCompatible, apiKey: e.target.value },
                  })
                }
                className="flex-1 bg-background border border-input rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={handleTestOpenAI}
                disabled={openaiTestStatus === 'testing' || !settings.openaiCompatible.baseUrl}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-muted hover:bg-muted/80 border border-border disabled:opacity-50 flex items-center gap-1.5 shrink-0"
              >
                {openaiTestStatus === 'testing' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : openaiTestStatus === 'success' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : openaiTestStatus === 'failed' ? (
                  <XCircle className="h-3.5 w-3.5 text-rose-500" />
                ) : null}
                Test Connection
              </button>
            </div>
            {settings.openaiCompatible.apiKey && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Masked Key: <span className="font-mono">{maskApiKey(settings.openaiCompatible.apiKey)}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Model Router Configuration */}
      <div className="border border-border/60 rounded-xl p-4 space-y-3.5 bg-card/50">
        <h3 className="font-medium text-foreground">Model Router & Fallback Order</h3>
        <p className="text-xs text-muted-foreground">
          When using <span className="font-semibold text-foreground">Auto</span> mode, Co-Drafter will route queries starting with your primary model and automatically fall back if temporary timeouts or capacity limits occur.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Primary Model</label>
            <select
              value={`${settings.routing.primaryProviderId}:${settings.routing.primaryModel}`}
              onChange={(e) => {
                const [pId, mId] = e.target.value.split(':');
                setSettings({
                  ...settings,
                  routing: {
                    ...settings.routing,
                    primaryProviderId: pId as LLMProviderId,
                    primaryModel: mId,
                  },
                });
              }}
              className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="sarvam:sarvam-105b">Sarvam 105B</option>
              <option value="sarvam:sarvam-30b">Sarvam 30B</option>
              <option value="openai-compatible:gpt-4o-mini">OpenAI-Compatible Endpoint</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Fallback Model</label>
            <select
              value={`${settings.routing.fallbacks[0]?.providerId || 'sarvam'}:${settings.routing.fallbacks[0]?.model || 'sarvam-30b'}`}
              onChange={(e) => {
                const [pId, mId] = e.target.value.split(':');
                setSettings({
                  ...settings,
                  routing: {
                    ...settings.routing,
                    fallbacks: [{ providerId: pId as LLMProviderId, model: mId }],
                  },
                });
              }}
              className="w-full bg-background border border-input rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="sarvam:sarvam-30b">Sarvam 30B</option>
              <option value="sarvam:sarvam-105b">Sarvam 105B</option>
              <option value="openai-compatible:gpt-4o-mini">OpenAI-Compatible Endpoint</option>
            </select>
          </div>
        </div>
      </div>

      {testMessage && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-lg text-xs">
          {testMessage}
        </div>
      )}

      {/* Save Action */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {isSaved && <span className="text-xs text-emerald-500 font-medium animate-in fade-in">Saved to local device!</span>}
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-xs hover:opacity-90 transition-opacity"
        >
          Save Co-Drafter AI Settings
        </button>
      </div>
    </div>
  );
}
