'use client';

import { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { SafeMarkdown } from './safe-markdown';
import { createGenerationProgress, generationStatus, type GenerationProgress } from '@/lib/ai/generation-progress';
import type { Project } from '@/lib/project';
import { AgentOrchestrator } from '@/lib/ai/orchestrator';
import {
  getProjectConversation,
  saveProjectConversation,
  clearProjectConversation,
  type ChatMessage,
} from '@/lib/ai/conversation-store';
import { buildAgentContext } from '@/lib/ai/context-builder';
import { loadAISettings } from '@/lib/ai/credentials';
import {
  LoaderCircle,
  Sparkles,
  X,
  Send,
  Square,
  RotateCcw,
  Bot,
  User,
  Layers,
  Wand2,
  AlertCircle,
  Clock,
  Zap,
} from 'lucide-react';

interface CoWriterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rootProject: Project;
  activeWorkspace?: Project;
  activeView?: string;
  currentSceneId?: string;
  selectedBlockIds?: string[];
  selectedText?: string;
}

export function CoWriterDrawer({
  isOpen,
  onClose,
  rootProject,
  activeWorkspace,
  activeView = 'Screenplay',
  currentSceneId,
  selectedBlockIds = [],
  selectedText = '',
}: CoWriterDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [progress, setProgress] = useState<GenerationProgress>({ stage: 'idle', content: '', elapsedMs: 0 });
  const [generation] = useState(() => createGenerationProgress(setProgress));
  const isGenerating = ['building_context', 'waiting_for_model', 'streaming'].includes(progress.stage);
  const streamingContent = progress.content;
  const followResponseRef = useRef(true);
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentProj = activeWorkspace || rootProject;
  const settings = loadAISettings();

  useEffect(() => () => generation.dispose(), [generation]);

  // Load chat history when project changes
  useEffect(() => {
    if (currentProj?.id) {
      const history = getProjectConversation(currentProj.id);
      setMessages(history);
    }
  }, [currentProj?.id]);

  // Save chat history when messages update
  useEffect(() => {
    if (currentProj?.id && messages.length > 0) {
      saveProjectConversation(currentProj.id, messages);
    }
  }, [currentProj?.id, messages]);

  // Auto scroll to bottom
  useEffect(() => {
    if (followResponseRef.current) chatEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages, streamingContent, progress.stage]);

  // Compute context pill tag
  const context = buildAgentContext({
    rootProject,
    activeWorkspace,
    activeView,
    currentSceneId,
    selectedBlockIds,
    selectedText,
  });

  const handleSendMessage = async (queryOverride?: string) => {
    const textToSend = queryOverride || inputValue;
    if (!textToSend || textToSend.trim().length === 0 || isGenerating) return;

    let request: ReturnType<typeof generation.start> = null;
    followResponseRef.current = true;
    flushSync(() => { request = generation.start(); });
    const activeRequest = request as ReturnType<typeof generation.start>;
    if (!activeRequest) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random()}`,
      role: 'user',
      content: textToSend.trim(),
      timestamp: Date.now(),
      contextTag: context.activeContextSummary,
    };

    setMessages((prev) => [...prev, userMessage]);
    if (!queryOverride) setInputValue('');

    try {
      const orchestrator = new AgentOrchestrator(settings);
      const historyForOrchestrator = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await orchestrator.stream(
        {
          rootProject,
          activeWorkspace,
          activeView,
          currentSceneId,
          selectedBlockIds,
          selectedText,
          history: historyForOrchestrator,
          userQuery: textToSend,
          selectedModel,
          abortSignal: activeRequest.signal,
          onRequestStart: () => activeRequest.waiting(),
        },
        (chunk) => {
          if (chunk.type === 'reset') activeRequest.waiting(true);
          if (chunk.content) activeRequest.chunk(chunk.content);
        }
      );

      if (activeRequest.signal.aborted) return;
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random()}`,
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        usage: response.usage,
        elapsedMs: activeRequest.elapsed(),
        fallback: response.fallback,
        contextTag: context.activeContextSummary,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      activeRequest.complete();
    } catch (err: any) {
      if (activeRequest.signal.aborted) return;
      if (err.name === 'AbortError' || err.failureType === 'cancelled') {
        generation.cancel();
      } else {
        activeRequest.fail();
        const errorMsg = err.message || 'An error occurred while generating response.';
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-err-${Date.now()}`,
            role: 'assistant',
            content: `⚠️ **Error**: ${errorMsg}\n\nPlease check your AI Provider settings or try selecting a different model.`,
            timestamp: Date.now(),
          },
        ]);
      }
    }
  };

  const handleStopGeneration = () => {
    const content = generation.cancel();
    if (content) setMessages(prev => [...prev, { id: `msg-${Date.now()}`, role: 'assistant', content: content + ' [Generation stopped]', timestamp: Date.now() }]);
  };

  const handleClearHistory = () => {
    if (currentProj?.id) {
      clearProjectConversation(currentProj.id);
      setMessages([]);
    }
  };

  const handleQuickAction = (promptLabel: string) => {
    const formattedQuery = selectedText
      ? `${promptLabel} for the following selected text:\n\n"${selectedText}"`
      : `${promptLabel} for the current scene.`;
    handleSendMessage(formattedQuery);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[420px] lg:w-[460px] bg-background border-l border-border shadow-2xl flex flex-col h-[100dvh] min-h-0 transition-transform duration-200"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      role="dialog"
      aria-label="Co-Drafter Panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/40 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              CO-DRAFTER
            </h2>
            <p className="text-[11px] text-muted-foreground truncate max-w-[200px]" title={context.activeContextSummary}>
              {context.activeContextSummary}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Model Selector */}
          <select
            aria-label="Co-Drafter model"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-muted/60 hover:bg-muted border border-border/60 text-[11px] rounded-md px-2 py-1 font-medium focus:outline-none"
          >
            <option value="auto">Auto (Router)</option>
            <option value="sarvam-105b">Sarvam 105B</option>
            <option value="sarvam-30b">Sarvam 30B</option>
            {settings.openaiCompatible.apiKey && (
              <option value={settings.openaiCompatible.model}>
                {settings.openaiCompatible.name} ({settings.openaiCompatible.model})
              </option>
            )}
          </select>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleClearHistory}
              title="Clear Conversation History"
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            title="Close Panel"
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Context Pill Indicator */}
      <div className="bg-muted/30 px-4 py-1.5 border-b border-border/40 flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
        <Layers className="h-3.5 w-3.5 text-primary/70 shrink-0" />
        <span className="truncate font-mono">Active Context: {context.activeContextSummary}</span>
      </div>

      {/* Conversation Thread */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4" onScroll={(event) => {
        const node = event.currentTarget;
        followResponseRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}>
        {messages.length === 0 && !isGenerating && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground my-auto">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3">
              <Wand2 className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Collaborate with Co-Drafter</h3>
            <p className="text-xs max-w-[280px] text-muted-foreground mb-4">
              Ask about screenplay scenes, character arcs, visual storytelling ideas, subtext, or production breakdown.
            </p>

            <div className="grid grid-cols-1 gap-2 w-full text-left max-w-[320px]">
              <button
                type="button"
                onClick={() => handleSendMessage("Analyze the dramatic conflict and pacing of the current scene.")}
                className="p-2.5 bg-muted/40 hover:bg-muted border border-border/60 rounded-lg text-xs text-foreground font-medium text-left transition-colors"
              >
                💡 "Analyze the conflict & pacing of this scene"
              </button>
              <button
                type="button"
                onClick={() => handleSendMessage("Suggest subtext and deeper visual action for the dialogue.")}
                className="p-2.5 bg-muted/40 hover:bg-muted border border-border/60 rounded-lg text-xs text-foreground font-medium text-left transition-colors"
              >
                🎭 "Suggest dialogue subtext & visual actions"
              </button>
              <button
                type="button"
                onClick={() => handleSendMessage("Check character voice continuity across scenes.")}
                className="p-2.5 bg-muted/40 hover:bg-muted border border-border/60 rounded-lg text-xs text-foreground font-medium text-left transition-colors"
              >
                🗣️ "Check character voice consistency"
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col gap-1.5 text-xs ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium px-1">
              {msg.role === 'user' ? (
                <>
                  <span>You</span>
                  <User className="h-3 w-3 text-primary" />
                </>
              ) : (
                <>
                  <Bot className="h-3 w-3 text-primary" />
                  <span>Co-Drafter</span>
                </>
              )}
            </div>

            <div
              className={`rounded-2xl px-3.5 py-2.5 max-w-[90%] space-y-1 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground font-normal rounded-tr-xs'
                  : 'bg-muted/60 text-foreground border border-border/40 rounded-tl-xs font-sans text-[14px] leading-relaxed'
              }`}
            >
              {msg.role === 'assistant' ? <SafeMarkdown content={msg.content} /> : msg.content}
            </div>

            {/* Response Usage & Fallback Badges */}
            {msg.role === 'assistant' && (msg.usage || msg.fallback || msg.elapsedMs !== undefined) && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono px-1">
                {msg.fallback ? (
                  <span className="text-amber-500 flex items-center gap-1 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                    <Zap className="h-2.5 w-2.5" />
                    Fell back to {msg.fallback.usedModel}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {((msg.elapsedMs ?? msg.usage?.durationMs ?? 0) / 1000).toFixed(1)}s
                  </span>
                )}
                {msg.usage?.inputTokens && (
                  <span>
                    {(msg.usage.inputTokens + (msg.usage.outputTokens || 0)).toLocaleString()} tokens
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        {generationStatus(progress.stage) && (
          <div className="flex flex-col gap-1.5 text-xs items-start">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1"><Bot className="h-3 w-3 text-primary" />Co-Drafter</div>
            <div className="rounded-2xl rounded-tl-xs px-3.5 py-2.5 bg-muted/60 border border-border/40">
              <div className="flex items-center gap-2">
                <span role="status" className="flex items-center gap-2"><LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 text-primary motion-safe:animate-spin" />{generationStatus(progress.stage)}</span>
                {progress.elapsedMs >= 3000 && <span className="text-[10px] text-muted-foreground tabular-nums">{(progress.elapsedMs / 1000).toFixed(1)}s</span>}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Using current project context</p>
            </div>
          </div>
        )}
        {/* Streaming Active Message */}
        {isGenerating && streamingContent && (
          <div className="flex flex-col gap-1.5 text-xs items-start">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium px-1">
              <Bot className="h-3 w-3 text-primary motion-safe:animate-pulse" />
              <span>Co-Drafter</span>
            </div>
            <div className="rounded-2xl px-3.5 py-2.5 max-w-[90%] bg-muted/60 text-foreground border border-border/40 rounded-tl-xs font-sans text-[14px] leading-relaxed">
              <SafeMarkdown content={streamingContent} />
              <span className="inline-block w-1.5 h-3 bg-primary motion-safe:animate-pulse ml-0.5" />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Screenplay Selection Quick Actions Bar */}
      {(selectedText || selectedBlockIds.length > 0) && (
        <div className="bg-primary/10 border-t border-b border-primary/20 px-3 py-2 shrink-0">
          <div className="flex items-center justify-between text-[11px] text-primary font-medium mb-1.5">
            <span className="flex items-center gap-1">
              <Wand2 className="h-3 w-3" /> Screenplay Selection Active
            </span>
            <span className="font-mono text-[10px] opacity-80">
              {selectedText ? `${selectedText.length} chars` : `${selectedBlockIds.length} blocks`}
            </span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            <button
              type="button"
              onClick={() => handleQuickAction('Analyse selection')}
              className="px-2.5 py-1 bg-background hover:bg-card border border-primary/30 rounded-md text-[11px] text-foreground shrink-0 font-medium transition-colors"
            >
              Analyse
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('Improve dialogue')}
              className="px-2.5 py-1 bg-background hover:bg-card border border-primary/30 rounded-md text-[11px] text-foreground shrink-0 font-medium transition-colors"
            >
              Improve dialogue
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('Add subtext & visual action')}
              className="px-2.5 py-1 bg-background hover:bg-card border border-primary/30 rounded-md text-[11px] text-foreground shrink-0 font-medium transition-colors"
            >
              Add subtext
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('Make more visual')}
              className="px-2.5 py-1 bg-background hover:bg-card border border-primary/30 rounded-md text-[11px] text-foreground shrink-0 font-medium transition-colors"
            >
              Make more visual
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction('Check character voice')}
              className="px-2.5 py-1 bg-background hover:bg-card border border-primary/30 rounded-md text-[11px] text-foreground shrink-0 font-medium transition-colors"
            >
              Check voice
            </button>
          </div>
        </div>
      )}

      {/* Input Box */}
      <div className="p-3 border-t border-border/50 bg-card/30 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex flex-col gap-2"
        >
          <div className="relative flex items-center">
            <textarea
              rows={2}
              placeholder="Ask Co-Drafter about this project…"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              className="w-full bg-background border border-input rounded-xl px-3 py-2 pr-10 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            {isGenerating ? (
              <button
                type="button"
                onClick={handleStopGeneration}
                title="Stop Generation"
                className="absolute right-2 p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-lg transition-colors"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!inputValue.trim()}
                title="Send Message"
                className="absolute right-2 p-1.5 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
            <span>Read-only collaborator mode</span>
            <span>Shift + Enter for line break</span>
          </div>
        </form>
      </div>
    </div>
  );
}
