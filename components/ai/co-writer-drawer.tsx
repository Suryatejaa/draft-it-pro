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
  createScreenplayProposal,
  createScreenplayAlternatives,
  getScreenplayAlternativesFailure,
  alternativeToProposal,
  ALTERNATIVES_MAX_EDITABLE_BLOCKS,
  inspectAlternativeResponse,
  inspectProposalResponse,
  validateProposal,
  type ProposalIntent,
  type ScreenplayProposal,
  type ScreenplaySelection,
} from '@/lib/ai/screenplay-proposal';
import { appliedToSceneMessage, buildAlternativesRepairInstruction, buildProposalProviderInstruction, buildProposalRepairInstruction, shouldRetryProposalResponse } from '@/lib/ai/proposal-request';
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
import { buildAlternativesEmptyContentRepairInstruction, classifyAlternativeProviderOutput, shouldRetryAlternativeProviderOutput } from '@/lib/ai/proposal-request';
import { getCompatibleCoDrafterActions, shouldConsumeInitialAction } from '@/lib/ai/co-drafter-actions';

const STRUCTURED_PROPOSAL_MAX_TOKENS = 4096;

interface CoWriterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  rootProject: Project;
  activeWorkspace?: Project;
  activeView?: string;
  currentSceneId?: string;
  selectedBlockIds?: string[];
  selectedText?: string;
  selection?: ScreenplaySelection;
  initialAction?: { intent: ProposalIntent | 'custom'; prompt: string; nonce: number };
  onResponseComplete?: () => void;
  onHostedRequestSettled?: () => void | Promise<void>;
  onApplyProposal?: (proposal: ScreenplayProposal, insertBelow?: boolean) => 'applied' | 'stale' | 'missing';
  hostedAiEnabled?: boolean;
  user?: { getIdToken: () => Promise<string> } | null;
}

function ProposalBlocks({ label, blocks, tone }: { label: string; blocks: ScreenplayProposal['original']; tone: 'removed' | 'added' }) {
  return (
    <section>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`space-y-1 border-l-2 pl-2 font-mono text-xs ${tone === 'removed' ? 'border-rose-400 bg-rose-500/5' : 'border-emerald-400 bg-emerald-500/5'}`}>
        {blocks.map((block) => <div key={block.id}><span className="mr-1 text-[10px] text-muted-foreground">[{block.type}]</span>{block.content}</div>)}
      </div>
    </section>
  );
}

function alternativeOperations(candidate: NonNullable<ChatMessage['alternatives']>['candidates'][number]) {
  if (Array.isArray(candidate.operations)) return candidate.operations;
  if (candidate.sourceBlockId && candidate.type && candidate.text) {
    return [{ operation: 'replace' as const, sourceBlockId: candidate.sourceBlockId, type: candidate.type, text: candidate.text }];
  }
  return [];
}

function alternativeRequestId() {
  return `ALT-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="px-2.5 py-1 bg-background hover:bg-card border border-primary/30 rounded-md text-[11px] text-foreground shrink-0 font-medium transition-colors">{label}</button>;
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
  selection,
  initialAction,
  onResponseComplete,
  onHostedRequestSettled,
  onApplyProposal,
  hostedAiEnabled = false,
  user,
}: CoWriterDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [progress, setProgress] = useState<GenerationProgress>({ stage: 'idle', content: '', elapsedMs: 0 });
  const [generation] = useState(() => createGenerationProgress(setProgress));
  const isGenerating = ['building_context', 'waiting_for_model', 'streaming'].includes(progress.stage);
  const streamingContent = progress.content;
  const followResponseRef = useRef(true);
  const suppressStreamingRef = useRef(false);
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [staleProposal, setStaleProposal] = useState<{ proposal: ScreenplayProposal; insertBelow: boolean } | null>(null);
  const [customProposalMode, setCustomProposalMode] = useState(false);
  const consumedInitialActionRef = useRef<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentProj = activeWorkspace || rootProject;
  const settings = loadAISettings();

  const redactProposalDiagnostic = (value: string) => value
    .replace(/sk_[A-Za-z0-9_-]{8,}/g, '[redacted-key]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '[redacted-key]');

  const logProposalDiagnostics = (metadata: Record<string, unknown>, rawResponse?: string, jsonCandidate?: string | null) => {
    if (process.env.NODE_ENV !== 'development') return;
    console.debug('[Co-Drafter]', 'proposal.pipeline', metadata);
    if (rawResponse !== undefined) console.debug('[Co-Drafter]', 'proposal.providerResponse', { rawResponse: redactProposalDiagnostic(rawResponse.slice(0, 1600)), jsonCandidate: jsonCandidate ? redactProposalDiagnostic(jsonCandidate.slice(0, 1600)) : null });
  };

  const logAlternativeDiagnostic = (requestId: string, event: string, data: Record<string, unknown>, error = false) => {
    if (process.env.NODE_ENV !== 'development') return;
    const prefix = `[CoDrafter:Alternatives][${requestId}][CLIENT]`;
    (error ? console.error : console.debug)(prefix, event, data);
    void fetch('/api/dev/alternatives-diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, event, data }),
    }).catch(() => {});
  };

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

  useEffect(() => {
    if (followResponseRef.current) chatEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages, streamingContent, progress.stage]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, currentProj?.id, messages.length]);

  // Compute context pill tag
  const focusedSelection = selection ?? (selectedText || selectedBlockIds.length ? {
    sceneId: currentSceneId ?? '', selectedBlockIds, selectedText, blockTypes: [], sourceRevision: '',
  } : undefined);
  const context = buildAgentContext({
    rootProject,
    activeWorkspace,
    activeView,
    currentSceneId,
    selectedBlockIds: focusedSelection?.selectedBlockIds,
    selectedText: focusedSelection?.selectedText,
  });

  const handleSendMessage = async (displayMessageOverride?: string, proposalIntent?: ProposalIntent, providerInstruction?: string, alternativesRequestId?: string) => {
    if (activeView !== 'Screenplay') return;
    const textToSend = displayMessageOverride || inputValue;
    if (!textToSend || textToSend.trim().length === 0 || isGenerating) return;
    const activeProposalIntent = proposalIntent ?? (customProposalMode ? 'custom' : undefined);
    const requestId = activeProposalIntent === 'alternatives' ? (alternativesRequestId ?? alternativeRequestId()) : undefined;
    const alternativesStartedAt = requestId ? Date.now() : 0;
    const finishAlternative = (data: Record<string, unknown>) => {
      if (requestId) logAlternativeDiagnostic(requestId, 'COMPLETE', { ...data, elapsedMs: Date.now() - alternativesStartedAt });
    };
    suppressStreamingRef.current = !!activeProposalIntent;
    const requestText = providerInstruction ?? (activeProposalIntent === 'custom'
      ? buildProposalProviderInstruction(textToSend, activeProposalIntent)
      : textToSend);
    if (activeProposalIntent && process.env.NODE_ENV === 'development') {
      console.debug('[Co-Drafter]', 'proposal.providerInstructionTransport', {
        displayMessage: textToSend.trim(),
        instructionLength: requestText.length,
        containsStructuredContract: requestText.includes('Return ONLY valid JSON'),
        selectedBlockIds: focusedSelection?.selectedBlockIds ?? [],
        selectedBlockTypes: focusedSelection?.blockTypes ?? [],
        sourceRevision: focusedSelection?.sourceRevision ?? '',
      });
    }

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
    if (!displayMessageOverride) {
      setInputValue('');
      setCustomProposalMode(false);
    }

    try {
      const hostedAuthToken = hostedAiEnabled ? await user?.getIdToken() : undefined;
      if (hostedAiEnabled && !hostedAuthToken) {
        throw new Error('Authentication required to use hosted Co-Drafter AI.');
      }
      const orchestrator = new AgentOrchestrator(
        hostedAuthToken ? undefined : settings,
        hostedAuthToken,
      );
      const historyForOrchestrator = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const sourceBlocks = focusedSelection?.sceneId
        ? currentProj.scenes.find((scene) => scene.id === focusedSelection.sceneId)?.blocks.filter((block) => focusedSelection.selectedBlockIds.includes(block.id)) ?? []
        : [];
      const editableSourceBlocks = sourceBlocks.filter((block) => ['action', 'dialogue', 'parenthetical'].includes(block.type));
      if (requestId) {
        const selectedBlocks = sourceBlocks.map((block) => ({ id: block.id, type: block.type, text: block.content, editable: editableSourceBlocks.some((source) => source.id === block.id) }));
        console.groupCollapsed(`[CoDrafter:Alternatives][${requestId}][CLIENT] REQUEST`);
        console.debug({
          requestId,
          intent: activeProposalIntent,
          sceneId: focusedSelection?.sceneId ?? '',
          sourceRevision: focusedSelection?.sourceRevision ?? '',
          selectedTextLength: focusedSelection?.selectedText.length ?? 0,
          selectedText: focusedSelection?.selectedText ?? '',
          selectedBlockCount: selectedBlocks.length,
          selectedBlocks,
          editableSourceCount: editableSourceBlocks.length,
          editableSources: editableSourceBlocks.map((block) => ({ id: block.id, type: block.type, text: block.content })),
          readOnlyContextCount: selectedBlocks.length - editableSourceBlocks.length,
        });
        console.groupEnd();
        logAlternativeDiagnostic(requestId, 'REQUEST', { requestId, intent: activeProposalIntent, sceneId: focusedSelection?.sceneId ?? '', sourceRevision: focusedSelection?.sourceRevision ?? '', selectedTextLength: focusedSelection?.selectedText.length ?? 0, selectedText: focusedSelection?.selectedText ?? '', selectedBlockCount: selectedBlocks.length, selectedBlocks, editableSourceCount: editableSourceBlocks.length, editableSources: editableSourceBlocks.map((block) => ({ id: block.id, type: block.type, text: block.content })), readOnlyContextCount: selectedBlocks.length - editableSourceBlocks.length });
      }
      const isStructuredProposal = !!(activeProposalIntent && focusedSelection && sourceBlocks.length);
      if (activeProposalIntent === 'alternatives' && process.env.NODE_ENV === 'development') {
        console.debug('[CoDrafter Alternatives]', {
          selectedBlockIds: focusedSelection?.selectedBlockIds ?? [],
          selectedBlockTypes: focusedSelection?.blockTypes ?? [],
          sourceBlockIds: sourceBlocks.map((block) => block.id),
          sourceBlockTypes: sourceBlocks.map((block) => block.type),
          sourceRevision: focusedSelection?.sourceRevision ?? '',
          editableSourceIds: sourceBlocks.filter((block) => ['action', 'dialogue', 'parenthetical'].includes(block.type)).map((block) => block.id),
        });
      }
      const requestedModel = selectedModel && selectedModel !== 'auto' ? selectedModel : settings.sarvam.model || 'sarvam-105b';
      const resolvedModel = requestedModel || 'sarvam-105b';
      if (requestId) {
        logAlternativeDiagnostic(requestId, 'PROVIDER_DISPATCH', {
          requestId,
          provider: 'sarvam',
          model: resolvedModel,
          requestedModel,
          reasoningEffort: null,
          reasoningMode: 'disabled',
          temperature: 0.2,
          maxTokens: isStructuredProposal ? 4096 : undefined,
          providerMessageCount: 2,
          uiConversationMessageCount: historyForOrchestrator.length,
          sourceCount: editableSourceBlocks.length,
          editableSourceIds: editableSourceBlocks.map((block) => block.id),
          editableSourceTypes: editableSourceBlocks.map((block) => block.type),
          approximatePromptChars: requestText.length + sourceBlocks.reduce((total, block) => total + block.content.length, 0),
          retryAttempt: 0,
          elapsedMs: Date.now() - alternativesStartedAt,
        });
      }
      let response = await orchestrator.stream(
        {
          rootProject,
          activeWorkspace,
          activeView,
          currentSceneId,
          selectedBlockIds: focusedSelection?.selectedBlockIds,
          selectedText: focusedSelection?.selectedText,
          selectionBlockTypes: focusedSelection?.blockTypes,
          sourceRevision: focusedSelection?.sourceRevision,
          history: historyForOrchestrator,
          userQuery: requestText,
          selectedModel,
          maxTokens: isStructuredProposal ? STRUCTURED_PROPOSAL_MAX_TOKENS : undefined,
          diagnostics: requestId ? { requestId, intent: 'alternatives', sourceBlocks: editableSourceBlocks.map((block) => ({ id: block.id, type: block.type, text: block.content })), retryAttempt: 0 } : undefined,
          onHostedRequestSettled,
          abortSignal: activeRequest.signal,
          onRequestStart: () => activeRequest.waiting(),
        },
        (chunk) => {
          if (chunk.type === 'reset') activeRequest.waiting(true);
          if (chunk.content) activeRequest.chunk(chunk.content);
        }
      );

      if (activeRequest.signal.aborted) {
        if (requestId) finishAlternative({ status: 'cancelled' });
        return;
      }
      const isAlternatives = activeProposalIntent === 'alternatives';
      let retryAttempt = 0;
      let alternativeInspection = isAlternatives && response.content.trim() ? inspectAlternativeResponse(response.content) : null;
      let providerOutputFailure = isAlternatives ? classifyAlternativeProviderOutput(response.content, response.reasoningContent, response.finishReason, STRUCTURED_PROPOSAL_MAX_TOKENS, response.usage?.outputTokens) : null;
      let alternatives = isAlternatives && alternativeInspection?.parsed
        ? createScreenplayAlternatives(focusedSelection!, sourceBlocks, alternativeInspection.parsed)
        : null;
      if (isAlternatives && !alternatives && response.finishReason === 'length') providerOutputFailure = classifyAlternativeProviderOutput(response.content, response.reasoningContent, response.finishReason, STRUCTURED_PROPOSAL_MAX_TOKENS, response.usage?.outputTokens);
      if (requestId) {
        let topLevelKeys: string[] = [];
        if (alternativeInspection?.jsonCandidate) {
          try { topLevelKeys = Object.keys(JSON.parse(alternativeInspection.jsonCandidate)); } catch { topLevelKeys = []; }
        }
        logAlternativeDiagnostic(requestId, 'PARSE', {
          rawContentLength: response.content.length,
          status: providerOutputFailure ? 'FAIL' : alternativeInspection?.parsed ? 'PASS' : 'FAIL',
          jsonCandidateFound: !!alternativeInspection?.jsonCandidate,
          jsonCandidateLength: alternativeInspection?.jsonCandidate?.length ?? 0,
          jsonParseSuccess: !!alternativeInspection?.parsed,
          topLevelKeys,
          alternativeCount: alternativeInspection?.parsed?.alternatives.length ?? 0,
          rejectionStage: alternativeInspection?.rejectionStage ?? null,
          rejectionReason: providerOutputFailure?.rejectionReason ?? alternativeInspection?.rejectionReason ?? null,
          rejectionCode: providerOutputFailure?.rejectionCode ?? null,
          finishReason: response.finishReason,
          reasoningContentLength: response.reasoningContent?.length ?? 0,
        });
        const expectedSourceIds = editableSourceBlocks.map((block) => block.id);
        const validationAlternatives = alternativeInspection?.parsed?.alternatives.map((candidate, index) => {
          const operations = alternativeOperations(candidate);
          const operationSourceIds = operations.map((operation) => operation.sourceBlockId);
          const duplicateIds = operationSourceIds.filter((id, operationIndex) => operationSourceIds.indexOf(id) !== operationIndex);
          const unknownIds = operationSourceIds.filter((id) => !expectedSourceIds.includes(id));
          const missingIds = expectedSourceIds.filter((id) => !operationSourceIds.includes(id));
          return { index, operationCount: operations.length, operationSourceIds, operationTypes: operations.map((operation) => operation.type), coverageExact: operationSourceIds.length === expectedSourceIds.length && missingIds.length === 0 && unknownIds.length === 0 && duplicateIds.length === 0, orderExact: operationSourceIds.every((id, operationIndex) => id === expectedSourceIds[operationIndex]), duplicateIds, unknownIds, missingIds, semanticTypesMatch: operations.every((operation) => editableSourceBlocks.find((source) => source.id === operation.sourceBlockId)?.type === operation.type), noOps: operations.filter((operation) => editableSourceBlocks.find((source) => source.id === operation.sourceBlockId)?.content.trim() === operation.text.trim()).map((operation) => operation.sourceBlockId) };
        }) ?? [];
        logAlternativeDiagnostic(requestId, 'VALIDATION', { status: alternatives ? 'PASS' : 'FAIL', expectedSourceIds, alternatives: validationAlternatives });
        if (!alternatives) logAlternativeDiagnostic(requestId, 'REJECTED', { rejectionStage: providerOutputFailure?.rejectionStage ?? (alternativeInspection?.parsed ? 'source_validation' : alternativeInspection?.rejectionStage ?? 'unknown'), rejectionCode: providerOutputFailure?.rejectionCode ?? (alternativeInspection?.parsed ? 'ALTERNATIVES_VALIDATION_FAILED' : 'ALTERNATIVES_PARSE_FAILED'), rejectionReason: providerOutputFailure?.rejectionReason ?? (alternativeInspection?.parsed ? getScreenplayAlternativesFailure(focusedSelection!, sourceBlocks, alternativeInspection.parsed) : alternativeInspection?.rejectionReason ?? 'No inspection result.'), expected: expectedSourceIds, actual: validationAlternatives });
      }
      if (isAlternatives && process.env.NODE_ENV === 'development') {
        const failure = alternativeInspection?.parsed ? getScreenplayAlternativesFailure(focusedSelection!, sourceBlocks, alternativeInspection.parsed) : alternativeInspection?.rejectionReason;
        console.debug('[CoDrafter Alternatives]', {
          providerResponseReceived: true,
          finishReason: response.finishReason,
          rawContentLength: response.content.length,
          jsonCandidateFound: !!alternativeInspection?.jsonCandidate,
          jsonParseSuccess: !!alternativeInspection?.parsed,
          schemaValidationSuccess: !!alternativeInspection?.parsed,
          candidateCount: alternativeInspection?.parsed?.alternatives.length ?? 0,
          candidateSourceBlockIds: alternativeInspection?.parsed?.alternatives.map((candidate) => candidate.operations.map((operation) => operation.sourceBlockId)) ?? [],
          candidateTypes: alternativeInspection?.parsed?.alternatives.map((candidate) => candidate.operations.map((operation) => operation.type)) ?? [],
          sourceLookupSuccess: sourceBlocks.some((block) => alternativeInspection?.parsed?.alternatives.some((candidate) => candidate.sourceBlockId === block.id)),
          semanticValidationSuccess: !!alternativeInspection?.parsed && !failure?.includes('type'),
          noOpValidationSuccess: !!alternativeInspection?.parsed && !failure?.includes('unchanged'),
          createScreenplayAlternativesSuccess: !!alternatives,
          rejectionStage: failure ? (alternativeInspection?.parsed ? 'source_validation' : alternativeInspection?.rejectionStage) : null,
          rejectionReason: failure ?? null,
        });
      }
      let inspection = !isAlternatives && isStructuredProposal ? inspectProposalResponse(response.content) : null;
      let parsed = inspection?.parsed ?? null;
      let proposal = isStructuredProposal && parsed
        ? createScreenplayProposal(focusedSelection, activeProposalIntent!, sourceBlocks, parsed)
        : null;
      let validation = proposal ? validateProposal(proposal, sourceBlocks, focusedSelection!.sourceRevision) : null;

      const shouldRepair = isStructuredProposal && (isAlternatives
        ? (shouldRetryAlternativeProviderOutput(response.content, response.reasoningContent ?? '', response.finishReason, retryAttempt) || (!alternatives && response.content.trim().length > 0))
        : shouldRetryProposalResponse(
        inspection,
        validation?.errors ?? (proposal?.proposalError ? [proposal.proposalError] : []),
        !!proposal?.noOp,
        response.finishReason,
        response.content,
      ));

      if (isStructuredProposal && process.env.NODE_ENV === 'development') {
        const structuredInspection = inspection ?? alternativeInspection;
        const structuredAlternatives = alternativeInspection?.parsed?.alternatives ?? [];
        console.debug('[Co-Drafter structured response pipeline]', {
          requestId: requestId ?? 'structured-local',
          hostedResponseStatus: 200,
          responseContentExists: response.content.trim().length > 0,
          responseContentType: typeof response.content,
          responseShape: {
            providerId: response.providerId,
            model: response.model,
            finishReason: response.finishReason,
            hasReasoningContent: Boolean(response.reasoningContent?.trim()),
          },
          toolCallsExist: Boolean(response.toolCalls?.length),
          parserPath: isAlternatives ? 'inspectAlternativeResponse' : 'inspectProposalResponse',
          jsonExtractionSucceeded: Boolean(structuredInspection?.jsonCandidate),
          alternativesParsed: structuredAlternatives.length,
          alternatives: structuredAlternatives.map((candidate, index) => ({
            index,
            operationCount: alternativeOperations(candidate).length,
            operationTypes: alternativeOperations(candidate).map((operation) => operation.type),
          })),
          rejectionStage: structuredInspection?.rejectionStage ?? (alternatives ? null : 'source_validation'),
          validationReason: isAlternatives
            ? providerOutputFailure?.rejectionReason
              ?? structuredInspection?.rejectionReason
              ?? (alternatives ? null : getScreenplayAlternativesFailure(focusedSelection!, sourceBlocks, alternativeInspection?.parsed ?? { alternatives: [] }))
            : inspection?.rejectionReason ?? validation?.errors.join(' ') ?? proposal?.proposalError ?? null,
        });
      }
      if (shouldRepair) {
        if (requestId) logAlternativeDiagnostic(requestId, 'REPAIR_TRIGGERED', { reason: providerOutputFailure?.rejectionReason ?? alternativeInspection?.rejectionReason ?? 'Grouped Alternatives validation failed.', originalFinishReason: response.finishReason, originalContentLength: response.content.length, rejectionStage: providerOutputFailure?.rejectionStage ?? (alternativeInspection?.parsed ? 'source_validation' : alternativeInspection?.rejectionStage ?? 'unknown') });
        const altFailureReason = alternativeInspection?.rejectionReason ?? null;
        const altCandidateCount = alternativeInspection?.parsed?.alternatives.length;
        const repairInstruction = isAlternatives
          ? providerOutputFailure ? buildAlternativesEmptyContentRepairInstruction(focusedSelection!, sourceBlocks) : buildAlternativesRepairInstruction(focusedSelection!, sourceBlocks, altFailureReason, altCandidateCount)
          : buildProposalRepairInstruction(focusedSelection!, sourceBlocks, !!proposal?.noOp);
        if (requestId) {
          const retryRequestedModel = selectedModel && selectedModel !== 'auto' ? selectedModel : settings.sarvam.model || 'sarvam-105b';
          const retryResolvedModel = retryRequestedModel || 'sarvam-105b';
          logAlternativeDiagnostic(requestId, 'PROVIDER_DISPATCH', {
            requestId,
            provider: 'sarvam',
            model: retryResolvedModel,
            requestedModel: retryRequestedModel,
            reasoningEffort: null,
            reasoningMode: 'disabled',
            temperature: 0.2,
            maxTokens: 4096,
            providerMessageCount: 2,
            uiConversationMessageCount: historyForOrchestrator.length,
            sourceCount: editableSourceBlocks.length,
            editableSourceIds: editableSourceBlocks.map((block) => block.id),
            editableSourceTypes: editableSourceBlocks.map((block) => block.type),
            approximatePromptChars: repairInstruction.length + sourceBlocks.reduce((total, block) => total + block.content.length, 0),
            retryAttempt: 1,
            elapsedMs: Date.now() - alternativesStartedAt,
          });
        }
        if (process.env.NODE_ENV === 'development') console.debug('[Co-Drafter]', 'proposal.repairRetry', { reason: inspection?.rejectionReason ?? validation?.errors.join(' ') ?? 'proposal contract failure' });
        response = await orchestrator.stream({
          rootProject,
          activeWorkspace,
          activeView,
          currentSceneId,
          selectedBlockIds: focusedSelection?.selectedBlockIds,
          selectedText: focusedSelection?.selectedText,
          selectionBlockTypes: focusedSelection?.blockTypes,
          sourceRevision: focusedSelection?.sourceRevision,
          history: historyForOrchestrator,
          userQuery: repairInstruction,
          selectedModel,
          maxTokens: STRUCTURED_PROPOSAL_MAX_TOKENS,
          diagnostics: requestId ? { requestId, intent: 'alternatives', sourceBlocks: editableSourceBlocks.map((block) => ({ id: block.id, type: block.type, text: block.content })), retryAttempt: 1 } : undefined,
          onHostedRequestSettled,
          abortSignal: activeRequest.signal,
          onRequestStart: () => activeRequest.waiting(),
        }, (chunk) => {
          if (chunk.type === 'reset') activeRequest.waiting(true);
          if (chunk.content) activeRequest.chunk(chunk.content);
        });
        if (isAlternatives) {
          retryAttempt = 1;
          alternativeInspection = response.content.trim() ? inspectAlternativeResponse(response.content) : null;
          const retryProviderOutputFailure = classifyAlternativeProviderOutput(response.content, response.reasoningContent, response.finishReason, STRUCTURED_PROPOSAL_MAX_TOKENS);
          alternatives = alternativeInspection?.parsed ? createScreenplayAlternatives(focusedSelection!, sourceBlocks, alternativeInspection.parsed) : null;
          if (requestId) {
            logAlternativeDiagnostic(requestId, 'REPAIR_RESULT', { success: !!alternatives, rejectionStage: retryProviderOutputFailure?.rejectionStage ?? alternativeInspection?.rejectionStage ?? (alternatives ? null : 'source_validation'), rejectionReason: retryProviderOutputFailure?.rejectionReason ?? alternativeInspection?.rejectionReason ?? (alternativeInspection?.parsed ? getScreenplayAlternativesFailure(focusedSelection!, sourceBlocks, alternativeInspection.parsed) : null) });
          }
          if (process.env.NODE_ENV === 'development') console.debug('[CoDrafter Alternatives]', 'repairRetryResult', { finishReason: response.finishReason, rawContentLength: response.content.length, parsed: !!alternativeInspection?.parsed, createSuccess: !!alternatives, rejectionStage: alternativeInspection?.rejectionStage ?? null, rejectionReason: alternativeInspection?.rejectionReason ?? (alternativeInspection?.parsed ? getScreenplayAlternativesFailure(focusedSelection!, sourceBlocks, alternativeInspection.parsed) : null) });
        } else {
          inspection = inspectProposalResponse(response.content);
          parsed = inspection.parsed;
          proposal = parsed ? createScreenplayProposal(focusedSelection!, activeProposalIntent!, sourceBlocks, parsed) : null;
          validation = proposal ? validateProposal(proposal, sourceBlocks, focusedSelection!.sourceRevision) : null;
        }
      }

      if (isStructuredProposal && (inspection || alternativeInspection)) {
        const responseInspection = inspection ?? alternativeInspection!;
        const initialRejectionReason = response.finishReason === 'length' && !response.content.trim()
          ? 'Provider response was truncated before any structured proposal content was returned.'
          : responseInspection.rejectionReason ?? null;
        logProposalDiagnostics({
          'proposal.providerResponseReceived': true,
          'proposal.rawResponseLength': response.content.length,
          'proposal.jsonCandidateFound': !!responseInspection.jsonCandidate,
          'proposal.topLevelKeys': inspection?.topLevelKeys ?? ['alternatives'],
          'proposal.operationCount': inspection?.operationCount ?? alternatives?.candidates.reduce((count, candidate) => count + candidate.operations.length, 0) ?? 0,
          'proposal.sourceBlockIds': inspection?.sourceBlockIds ?? alternatives?.candidates.flatMap((candidate) => candidate.operations.map((operation) => operation.sourceBlockId)) ?? [],
          'proposal.jsonParseSuccess': inspection?.jsonParseSuccess ?? !!alternativeInspection?.parsed,
          'proposal.schemaValidationSuccess': inspection?.schemaValidationSuccess ?? !!alternativeInspection?.parsed,
          'proposal.sourceValidationSuccess': sourceBlocks.length > 0,
          'proposal.semanticValidationSuccess': inspection?.semanticValidationSuccess ?? !!alternativeInspection?.parsed,
          'proposal.meaningfulChange': false,
          'proposal.rejectionStage': responseInspection.rejectionStage ?? null,
          'proposal.rejectionReason': initialRejectionReason,
        }, response.content, responseInspection.jsonCandidate);
      }

      if (isStructuredProposal && ((isAlternatives && !alternatives) || (!isAlternatives && !parsed))) {
        setMessages((prev) => [...prev, {
          id: `msg-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          content: "Co-Drafter couldn't create a valid screenplay proposal. Try again.",
          timestamp: Date.now(),
          usage: response.usage,
          elapsedMs: activeRequest.elapsed(),
          fallback: response.fallback,
          contextTag: context.activeContextSummary,
        }]);
        activeRequest.complete();
        onResponseComplete?.();
        const finalProviderFailure = isAlternatives ? classifyAlternativeProviderOutput(response.content, response.reasoningContent, response.finishReason, STRUCTURED_PROPOSAL_MAX_TOKENS) : null;
        if (requestId) finishAlternative({ status: 'failure', rejectionStage: finalProviderFailure?.rejectionStage ?? (alternativeInspection?.parsed ? 'source_validation' : alternativeInspection?.rejectionStage ?? 'unknown'), rejectionCode: finalProviderFailure?.rejectionCode ?? 'ALTERNATIVES_INVALID', rejectionReason: finalProviderFailure?.rejectionReason ?? (alternativeInspection?.parsed ? getScreenplayAlternativesFailure(focusedSelection!, sourceBlocks, alternativeInspection.parsed) : alternativeInspection?.rejectionReason ?? 'No valid Alternatives response.') });
        return;
      }

      if (isAlternatives && alternatives) {
        const assistantMessage: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          content: 'Alternatives generated.',
          timestamp: Date.now(),
          usage: response.usage,
          elapsedMs: activeRequest.elapsed(),
          fallback: response.fallback,
          contextTag: context.activeContextSummary,
          alternatives,
        };
        setMessages((prev) => [...prev, assistantMessage]);
        if (process.env.NODE_ENV === 'development') console.debug('[CoDrafter Alternatives]', 'messageConversionSuccess', { sourceBlockId: alternatives.original.id, candidateCount: alternatives.candidates.length, persistedShape: 'alternatives' });
        activeRequest.complete();
        onResponseComplete?.();
        if (requestId) finishAlternative({ status: 'success', alternativeCount: alternatives.candidates.length, sourceCount: alternatives.originalBlocks.length });
        return;
      }

      if (isAlternatives && process.env.NODE_ENV === 'development') {
        console.debug('[CoDrafter Alternatives]', 'renderBranchNotReached', {
          rejectionStage: alternativeInspection?.parsed ? 'source_validation' : alternativeInspection?.rejectionStage ?? 'unknown',
          rejectionReason: alternativeInspection?.parsed ? getScreenplayAlternativesFailure(focusedSelection!, sourceBlocks, alternativeInspection.parsed) : alternativeInspection?.rejectionReason ?? 'No Alternatives inspection available.',
        });
      }

      if (proposal && validation) {
        const sourceValidationErrors = validation.errors.filter((error) => /source block|sourceBlockId|Selection references|Stale source revision/i.test(error));
        const semanticValidationErrors = validation.errors.filter((error) => /Semantic type mismatch/i.test(error));
        const meaningfulChange = !proposal.noOp && !validation.errors.some((error) => /meaningful change|no-op/i.test(error));
        logProposalDiagnostics({
          'proposal.providerResponseReceived': true,
          'proposal.rawResponseLength': response.content.length,
          'proposal.jsonCandidateFound': !!inspection?.jsonCandidate,
          'proposal.topLevelKeys': inspection?.topLevelKeys ?? [],
          'proposal.operationCount': inspection?.operationCount ?? 0,
          'proposal.sourceBlockIds': inspection?.sourceBlockIds ?? [],
          'proposal.jsonParseSuccess': inspection?.jsonParseSuccess ?? false,
          'proposal.schemaValidationSuccess': inspection?.schemaValidationSuccess ?? false,
          'proposal.sourceValidationSuccess': sourceValidationErrors.length === 0,
          'proposal.semanticValidationSuccess': inspection?.semanticValidationSuccess === true && semanticValidationErrors.length === 0,
          'proposal.meaningfulChange': meaningfulChange,
          'proposal.rejectionStage': validation.valid ? null : sourceValidationErrors.length ? 'source' : semanticValidationErrors.length ? 'semantic' : meaningfulChange ? 'validation' : 'meaningful_change',
          'proposal.rejectionReason': validation.valid ? null : validation.errors.join(' '),
        });
      }
      if (proposal?.noOp || (validation && !validation.valid)) {
        setMessages((prev) => [...prev, {
          id: `msg-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          content: proposal?.proposalError ?? "Co-Drafter couldn't create a valid screenplay proposal. Try again.",
          timestamp: Date.now(),
          usage: response.usage,
          elapsedMs: activeRequest.elapsed(),
          fallback: response.fallback,
          contextTag: context.activeContextSummary,
        }]);
        activeRequest.complete();
        onResponseComplete?.();
        return;
      }

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random()}`,
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        usage: response.usage,
        elapsedMs: activeRequest.elapsed(),
        fallback: response.fallback,
        contextTag: context.activeContextSummary,
        ...(proposal ? { proposal } : {}),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      activeRequest.complete();
      onResponseComplete?.();
    } catch (err: any) {
      if (activeRequest.signal.aborted) {
        if (requestId) finishAlternative({ status: 'cancelled' });
        return;
      }
      if (requestId) {
        logAlternativeDiagnostic(requestId, 'EXCEPTION', { name: err?.name ?? 'Error', message: err?.message ?? String(err), stack: err?.stack }, true);
        finishAlternative({ status: err?.name === 'AbortError' ? 'cancelled' : 'provider_error', httpStatus: err?.status, finishReason: undefined, rejectionReason: err?.message ?? String(err) });
      }
      if (err.name === 'AbortError' || err.failureType === 'cancelled') {
        generation.cancel();
      } else {
        activeRequest.fail();
        const errorMsg = err.message || 'An error occurred while generating response.';
        const providerSettingsHelp = hostedAiEnabled
          ? ''
          : '\n\nPlease check your AI Provider settings or try selecting a different model.';
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-err-${Date.now()}`,
            role: 'assistant',
            content: `⚠️ **Error**: ${errorMsg}${providerSettingsHelp}`,
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

  const handleQuickAction = (label: string, intent: ProposalIntent) => {
    const proposalBlocks = focusedSelection?.sceneId
      ? currentProj.scenes.find((scene) => scene.id === focusedSelection.sceneId)?.blocks.filter((block) => focusedSelection.selectedBlockIds.includes(block.id)) ?? []
      : [];
    if (intent === 'alternatives') {
      const editableCount = proposalBlocks.filter((block) => ['action', 'dialogue', 'parenthetical'].includes(block.type)).length;
      if (editableCount === 0 || editableCount > ALTERNATIVES_MAX_EDITABLE_BLOCKS) {
        setMessages((previous) => [...previous, {
          id: `msg-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          content: editableCount === 0
            ? 'Select an action, dialogue, or parenthetical block for Alternatives.'
            : `Alternatives works best on a focused passage. Select up to ${ALTERNATIVES_MAX_EDITABLE_BLOCKS} screenplay blocks.`,
          timestamp: Date.now(),
          contextTag: context.activeContextSummary,
        }]);
        return;
      }
    }
    handleSendMessage(label, intent, buildProposalProviderInstruction(label, intent, focusedSelection, proposalBlocks), intent === 'alternatives' ? alternativeRequestId() : undefined);
  };

  useEffect(() => {
    if (activeView !== 'Screenplay' || !isOpen || !initialAction || !shouldConsumeInitialAction(consumedInitialActionRef.current, initialAction.nonce)) return;
    consumedInitialActionRef.current = initialAction.nonce;
    if (initialAction.intent === 'custom') return;
    handleQuickAction(initialAction.prompt, initialAction.intent);
  }, [initialAction, isOpen]);

  const handleProposalAction = (proposal: ScreenplayProposal, insertBelow = false, reviewStale = false) => {
    if (proposal.noOp || proposal.proposalError) return;
    const result = onApplyProposal?.(proposal, insertBelow);
    if (result === 'stale') {
      if (reviewStale) setStaleProposal(null);
      else setStaleProposal({ proposal, insertBelow });
      return;
    }
    if (result === 'applied') {
      setMessages((previous) => [...previous, { id: `msg-${Date.now()}`, role: 'assistant', content: appliedToSceneMessage(currentProj, proposal.sceneId), timestamp: Date.now() }]);
      setStaleProposal(null);
    }
  };

  const handleAlternativeAction = (alternatives: NonNullable<ChatMessage['alternatives']>, candidate: NonNullable<ChatMessage['alternatives']>['candidates'][number]) => {
    const normalized = { ...candidate, operations: alternativeOperations(candidate) };
    handleProposalAction(alternativeToProposal({
      ...alternatives,
      originalBlocks: alternatives.originalBlocks ?? [alternatives.original],
    }, normalized));
  };


  const selectionTypes = focusedSelection?.blockTypes ?? [];
  const compatibleActions = selectionTypes.length === 1 ? getCompatibleCoDrafterActions(selectionTypes[0]) : [];

  if (!isOpen) return null;

  return (
    <div
      className="co-drafter-panel bg-background border-l border-border shadow-2xl flex flex-col min-h-0 transition-transform duration-200"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      role="dialog"
      aria-label="Co-Drafter Panel"
    >
      {/* Header */}
      <div className="co-drafter-header flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
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
              {msg.alternatives ? (
                <div className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-black">Alternatives</div>
                  <ProposalBlocks label="Original" blocks={msg.alternatives.originalBlocks ?? [msg.alternatives.original]} tone="removed" />
                  {msg.alternatives.candidates.map((candidate, index) => (
                    <section key={`${alternativeOperations(candidate)[0]?.sourceBlockId ?? 'alternative'}-${index}`} className="space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Option {index + 1}</div>
                      <div className="space-y-1 border-l-2 border-emerald-400 bg-emerald-500/5 pl-2 font-mono text-xs">
                        {alternativeOperations(candidate).map((operation) => <div key={operation.sourceBlockId}><span className="mr-1 text-[10px] text-muted-foreground">[{operation.type}]</span>{operation.text}</div>)}
                      </div>
                      <button type="button" onClick={() => handleAlternativeAction(msg.alternatives!, candidate)} className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground">Apply</button>
                    </section>
                  ))}
                  {msg.alternatives.explanation && <p className="text-xs text-muted-foreground">{msg.alternatives.explanation}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => navigator.clipboard?.writeText(msg.alternatives!.candidates.map((candidate) => alternativeOperations(candidate).map((operation) => operation.text).join('\n')).join('\n\n'))} className="rounded-md border border-border px-2 py-1 text-[11px] font-medium">Copy</button>
                    <button type="button" onClick={() => setMessages((previous) => previous.filter((message) => message.id !== msg.id))} className="rounded-md border border-border px-2 py-1 text-[11px] font-medium">Discard</button>
                  </div>
                </div>
              ) : msg.proposal && !msg.proposal.noOp ? (
                <div className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-black">{msg.proposal.intent.replaceAll('_', ' ')}</div>
                  <ProposalBlocks label="Original" blocks={msg.proposal.original} tone="removed" />
                  <ProposalBlocks label="Suggested" blocks={msg.proposal.suggested} tone="added" />
                  {msg.proposal.explanation && <p className="text-xs text-muted-foreground">{msg.proposal.explanation}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" disabled={msg.proposal.noOp} onClick={() => handleProposalAction(msg.proposal!)} className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50">Apply</button>
                    <button type="button" disabled={msg.proposal.noOp} onClick={() => handleProposalAction(msg.proposal!, true)} className="rounded-md border border-border px-2 py-1 text-[11px] font-medium disabled:opacity-50">Insert below</button>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(msg.proposal!.suggested.map((block) => block.content).join('\n'))} className="rounded-md border border-border px-2 py-1 text-[11px] font-medium">Copy</button>
                    <button type="button" onClick={() => setMessages((previous) => previous.filter((message) => message.id !== msg.id))} className="rounded-md border border-border px-2 py-1 text-[11px] font-medium">Discard</button>
                  </div>
                </div>
              ) : msg.role === 'assistant' ? <SafeMarkdown content={msg.content} /> : msg.content}
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
        {isGenerating && streamingContent && !suppressStreamingRef.current && (
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
      {focusedSelection && (
        <div className="bg-primary/10 border-t border-b border-primary/20 px-3 py-2 shrink-0">
          <div className="flex items-center justify-between text-[11px] text-black font-medium mb-1.5">
            <span className="flex items-center gap-1">
              <Wand2 className="h-3 w-3" /> Screenplay Selection Active
            </span>
            <span className="font-mono text-[10px] opacity-80">
              {focusedSelection.selectedText ? `${focusedSelection.selectedText.length} chars` : `${focusedSelection.selectedBlockIds.length} blocks`}
            </span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {compatibleActions.map((action) => <QuickAction key={action.id} label={action.label} onClick={() => handleQuickAction(action.prompt, action.id as ProposalIntent)} />)}
            <QuickAction label="Custom" onClick={() => { setCustomProposalMode(true); setInputValue('Rewrite this selection: '); }} />
          </div>
        </div>
      )}

      {staleProposal && (
        <div className="mx-3 mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
          <p className="mb-2 font-medium">Screenplay changed since this suggestion was generated.</p>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => handleProposalAction(staleProposal.proposal, staleProposal.insertBelow, true)} className="rounded-md border border-border px-2 py-1 text-[11px]">Review anyway</button>
            <button type="button" onClick={() => { setStaleProposal(null); handleQuickAction('Generate again', staleProposal.proposal.intent); }} className="rounded-md border border-border px-2 py-1 text-[11px]">Generate again</button>
            <button type="button" onClick={() => setStaleProposal(null)} className="rounded-md border border-border px-2 py-1 text-[11px]">Cancel</button>
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
