import { uid, type Block, type ElementType } from '../project.ts';

export type ProposalIntent =
  | 'improve_dialogue'
  | 'add_subtext'
  | 'make_visual'
  | 'tighten'
  | 'alternatives'
  | 'character_voice'
  | 'custom';

export type ProposalOperation = {
  operation: 'replace';
  sourceBlockId: string;
  type: ElementType;
  text: string;
};

export type ParsedProposalOperation = Omit<ProposalOperation, 'operation'> & {
  operation?: 'replace';
};

export type ScreenplayAlternativeOperation = ProposalOperation;

export type ScreenplayAlternative = {
  operations: ScreenplayAlternativeOperation[];
  sourceBlockId?: string;
  type?: ElementType;
  text?: string;
};

export type ScreenplayAlternatives = {
  sceneId: string;
  sourceRevision: string;
  intent: 'alternatives';
  original: Block;
  originalBlocks: Block[];
  candidates: ScreenplayAlternative[];
  explanation?: string;
  preservedBlockIds: string[];
};

export type ScreenplaySelection = {
  sceneId: string;
  selectedBlockIds: string[];
  selectedText: string;
  blockTypes: ElementType[];
  sourceRevision: string;
};

export type ScreenplayProposal = {
  id: string;
  sceneId: string;
  sourceBlockIds: string[];
  sourceRevision: string;
  intent: ProposalIntent;
  original: Block[];
  suggested: Block[];
  explanation?: string;
  operations: ProposalOperation[];
  preservedBlockIds: string[];
  noOp: boolean;
  proposalError?: string;
  createdAt: string;
};

const VALID_BLOCK_TYPES = new Set<ElementType>([
  'scene_heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'general',
]);
const ALTERNATIVE_SOURCE_TYPES = new Set<ElementType>(['action', 'dialogue', 'parenthetical']);
export const ALTERNATIVES_MAX_EDITABLE_BLOCKS = 8;

export function isCoDrafterEditableBlock(block: Pick<Block, 'type'>) {
  return ALTERNATIVE_SOURCE_TYPES.has(block.type);
}

export type ProposalResponseInspection = {
  parsed: { blocks: Omit<Block, 'id'>[]; operations: ParsedProposalOperation[]; reasoning?: string } | null;
  jsonCandidate: string | null;
  topLevelKeys: string[];
  operationCount: number;
  sourceBlockIds: string[];
  jsonParseSuccess: boolean;
  schemaValidationSuccess: boolean;
  semanticValidationSuccess: boolean;
  rejectionStage?: 'json_candidate' | 'json_parse' | 'schema' | 'semantic';
  rejectionReason?: string;
};

export function extractProposalJsonCandidate(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidates = [
    fenced?.[1]?.trim() ?? '',
    content.trim(),
  ];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.startsWith('{') && (trimmed.includes('"operations"') || trimmed.includes('"blocks"') || trimmed.includes('"alternatives"'))) return trimmed;
  }

  let start = content.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < content.length; index += 1) {
      const char = content[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = content.slice(start, index + 1).trim();
          if (candidate.includes('"operations"') || candidate.includes('"blocks"') || candidate.includes('"alternatives"')) return candidate;
          break;
        }
      }
    }
    start = content.indexOf('{', start + 1);
  }

  return null;
}

export type AlternativeResponseInspection = {
  parsed: { alternatives: ScreenplayAlternative[]; reasoning?: string } | null;
  jsonCandidate: string | null;
  rejectionStage?: 'json_candidate' | 'json_parse' | 'schema' | 'semantic';
  rejectionReason?: string;
};

export function inspectAlternativeResponse(content: string): AlternativeResponseInspection {
  const jsonCandidate = extractProposalJsonCandidate(content);
  if (!jsonCandidate) return { parsed: null, jsonCandidate: null, rejectionStage: 'json_candidate', rejectionReason: 'No alternatives JSON was found.' };
  try {
    const value = JSON.parse(jsonCandidate) as { alternatives?: unknown; reasoning?: unknown };
    if (!Array.isArray(value.alternatives)) return { parsed: null, jsonCandidate, rejectionStage: 'schema', rejectionReason: 'Expected an alternatives array.' };
    if (value.alternatives.length !== 3) return { parsed: null, jsonCandidate, rejectionStage: 'schema', rejectionReason: 'Alternatives must contain exactly 3 candidates.' };
    const alternatives = value.alternatives.map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return null;
      const item = candidate as { operations?: unknown; sourceBlockId?: unknown; type?: unknown; text?: unknown };
      if (Array.isArray(item.operations)) return { operations: item.operations };
      if (typeof item.sourceBlockId === 'string' && typeof item.type === 'string' && typeof item.text === 'string') {
        return { operations: [{ operation: 'replace' as const, sourceBlockId: item.sourceBlockId, type: item.type as ElementType, text: item.text }] };
      }
      return null;
    });
    if (!alternatives.every((candidate) => candidate?.operations.every((operation) => {
      if (!operation || typeof operation !== 'object') return false;
      const item = operation as Partial<ScreenplayAlternativeOperation>;
      return item.operation === 'replace' && typeof item.sourceBlockId === 'string' && typeof item.type === 'string' && VALID_BLOCK_TYPES.has(item.type as ElementType) && typeof item.text === 'string' && item.text.trim().length > 0;
    }))) return { parsed: null, jsonCandidate, rejectionStage: 'schema', rejectionReason: 'Each alternative requires replacement operations with sourceBlockId, type, and complete text.' };
    const normalized = alternatives as ScreenplayAlternative[];
    if (!normalized.every((candidate) => candidate.operations.length === 1)) {
      return { parsed: null, jsonCandidate, rejectionStage: 'schema', rejectionReason: 'Each alternative must contain exactly one replacement operation.' };
    }
    if (!normalized.every((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false;
      return candidate.operations.every((operation) => operation.operation === 'replace');
    })) return { parsed: null, jsonCandidate, rejectionStage: 'schema', rejectionReason: 'Alternatives only support replace operations.' };
    return { parsed: { alternatives: normalized.map((candidate) => {
      const operations = candidate.operations.map((operation) => ({ ...operation, text: operation.text.trim() }));
      return { operations, ...(operations.length === 1 ? { sourceBlockId: operations[0].sourceBlockId, type: operations[0].type, text: operations[0].text } : {}) };
    }), ...(typeof value.reasoning === 'string' && value.reasoning.trim() ? { reasoning: value.reasoning.trim() } : {}) }, jsonCandidate };
  } catch (error) {
    return { parsed: null, jsonCandidate, rejectionStage: 'json_parse', rejectionReason: error instanceof Error ? error.message : 'JSON.parse failed.' };
  }
}

export function createScreenplayAlternatives(selection: ScreenplaySelection, original: Block[], parsed: { alternatives: ScreenplayAlternative[]; reasoning?: string }): ScreenplayAlternatives | null {
  const normalized = normalizeAlternativeCandidates(parsed.alternatives);
  const failure = getScreenplayAlternativesFailure(selection, original, { ...parsed, alternatives: normalized });
  if (failure) return null;
  const editable = original.filter((block) => ALTERNATIVE_SOURCE_TYPES.has(block.type));
  return { sceneId: selection.sceneId, sourceRevision: selection.sourceRevision, intent: 'alternatives', original: editable[0], originalBlocks: editable, candidates: normalized, explanation: parsed.reasoning, preservedBlockIds: selection.selectedBlockIds.filter((id) => !editable.some((source) => source.id === id)) };
}

function normalizeAlternativeCandidates(candidates: ScreenplayAlternative[]): ScreenplayAlternative[] {
  return candidates.map((candidate) => {
    if (candidate.operations) return candidate;
    if (candidate.sourceBlockId && candidate.type && candidate.text) {
      return { operations: [{ operation: 'replace', sourceBlockId: candidate.sourceBlockId, type: candidate.type, text: candidate.text }], sourceBlockId: candidate.sourceBlockId, type: candidate.type, text: candidate.text };
    }
    return candidate;
  });
}

export function getScreenplayAlternativesFailure(selection: ScreenplaySelection, original: Block[], parsed: { alternatives: ScreenplayAlternative[]; reasoning?: string }): string | null {
  const editable = original.filter((block) => ALTERNATIVE_SOURCE_TYPES.has(block.type));
  const candidates = normalizeAlternativeCandidates(parsed.alternatives);
  if (editable.length === 0) return 'No editable action, dialogue, or parenthetical source matched the selection.';
  if (editable.length !== 1) return 'Alternatives require exactly one editable source block.';
  if (editable.length > ALTERNATIVES_MAX_EDITABLE_BLOCKS) return `Alternatives works best on a focused passage. Select up to ${ALTERNATIVES_MAX_EDITABLE_BLOCKS} screenplay blocks.`;
  if (candidates.length !== 3) return 'Alternatives must contain exactly 3 candidates.';
  const expectedIds = editable.map((source) => source.id);
  for (const candidate of candidates) {
    const operations = candidate.operations;
    if (operations.length !== 1) return 'Each alternative must contain exactly one replacement operation.';
    if (operations.some((operation, index) => operation.sourceBlockId !== expectedIds[index])) return 'Alternative operations must preserve source ordering and coverage.';
    if (new Set(operations.map((operation) => operation.sourceBlockId)).size !== operations.length) return 'An alternative contains a duplicate sourceBlockId.';
    for (const operation of operations) {
      const source = editable.find((block) => block.id === operation.sourceBlockId);
      if (!source) return `No editable source matched sourceBlockId ${operation.sourceBlockId}.`;
      if (operation.type !== source.type) return `Candidate semantic type does not match source type ${source.type}.`;
      if (!operation.text.trim()) return 'An alternative candidate is empty.';
      if (operation.text.trim() === source.content.trim()) return `Alternative for ${source.id} is unchanged from the source.`;
    }
  }
  const candidateSignatures = candidates.map((candidate) => candidate.operations.map((operation) => operation.text.trim()).join('\n'));
  if (new Set(candidateSignatures).size !== candidateSignatures.length) {
    return 'Alternatives must contain distinct replacements.';
  }
  return null;
}

export function alternativeToProposal(alternatives: ScreenplayAlternatives, candidate: ScreenplayAlternative): ScreenplayProposal {
  const suggested = candidate.operations.map((operation) => ({ id: uid(), type: operation.type, content: operation.text }));
  return { id: uid(), sceneId: alternatives.sceneId, sourceBlockIds: alternatives.originalBlocks.map((block) => block.id), sourceRevision: alternatives.sourceRevision, intent: 'alternatives', original: alternatives.originalBlocks, suggested, explanation: alternatives.explanation, operations: candidate.operations, preservedBlockIds: alternatives.preservedBlockIds, noOp: false, createdAt: new Date().toISOString() };
}

export function inspectProposalResponse(content: string): ProposalResponseInspection {
  const jsonCandidate = extractProposalJsonCandidate(content);
  if (!jsonCandidate) return {
    parsed: null,
    jsonCandidate: null,
    topLevelKeys: [],
    operationCount: 0,
    sourceBlockIds: [],
    jsonParseSuccess: false,
    schemaValidationSuccess: false,
    semanticValidationSuccess: false,
    rejectionStage: 'json_candidate',
    rejectionReason: 'No JSON object containing operations was found.',
  };
  try {
    const parsed: unknown = JSON.parse(jsonCandidate);
    if (!parsed || typeof parsed !== 'object') return {
      parsed: null,
      jsonCandidate,
      topLevelKeys: [],
      operationCount: 0,
      sourceBlockIds: [],
      jsonParseSuccess: true,
      schemaValidationSuccess: false,
      semanticValidationSuccess: false,
      rejectionStage: 'schema',
      rejectionReason: 'Expected an object containing replacement operations.',
    };
    const value = parsed as { blocks?: unknown; operations?: unknown };
    const topLevelKeys = Object.keys(parsed);
    const rawOperations = Array.isArray(value.operations) ? value.operations : [];
    const rawBlocks = Array.isArray(value.blocks) ? value.blocks : [];
    if (!Array.isArray(value.operations)) return {
      parsed: null,
      jsonCandidate,
      topLevelKeys,
      operationCount: 0,
      sourceBlockIds: [],
      jsonParseSuccess: true,
      schemaValidationSuccess: false,
      semanticValidationSuccess: false,
      rejectionStage: 'schema',
      rejectionReason: rawBlocks.length ? 'Legacy blocks schema is not accepted; operations are required.' : 'Expected an operations array.',
    };
    const candidates = rawOperations;
    if (!candidates.length || !candidates.every((block) => {
      if (!block || typeof block !== 'object') return false;
      const candidate = block as { sourceBlockId?: unknown; type?: unknown; text?: unknown };
      return (rawOperations.length === 0 || typeof candidate.sourceBlockId === 'string')
        && typeof candidate.text === 'string' && candidate.text.trim().length > 0 && typeof candidate.type === 'string';
    })) return {
      parsed: null,
      jsonCandidate,
      topLevelKeys,
      operationCount: rawOperations.length,
      sourceBlockIds: rawOperations.map((block) => typeof (block as { sourceBlockId?: unknown }).sourceBlockId === 'string' ? (block as { sourceBlockId: string }).sourceBlockId : '').filter(Boolean),
      jsonParseSuccess: true,
      schemaValidationSuccess: false,
      semanticValidationSuccess: false,
      rejectionStage: 'schema',
      rejectionReason: 'Each replacement requires a sourceBlockId, type, and non-empty text.',
    };
    if (!candidates.every((block) => VALID_BLOCK_TYPES.has((block as { type: string }).type as ElementType))) return {
      parsed: null,
      jsonCandidate,
      topLevelKeys,
      operationCount: rawOperations.length,
      sourceBlockIds: rawOperations.map((block) => typeof (block as { sourceBlockId?: unknown }).sourceBlockId === 'string' ? (block as { sourceBlockId: string }).sourceBlockId : '').filter(Boolean),
      jsonParseSuccess: true,
      schemaValidationSuccess: true,
      semanticValidationSuccess: false,
      rejectionStage: 'semantic',
      rejectionReason: 'One or more blocks use an unsupported screenplay type.',
    };
    const reasoning = (parsed as { reasoning?: unknown }).reasoning;
    return {
      parsed: {
        blocks: candidates.map((block) => {
          const candidate = block as { type: ElementType; text: string };
          return { type: candidate.type, content: candidate.text.trim() };
        }),
        operations: rawOperations.map((block) => {
          const candidate = block as { sourceBlockId: string; type: ElementType; text: string };
          return { operation: 'replace', sourceBlockId: candidate.sourceBlockId, type: candidate.type, text: candidate.text.trim() };
        }),
        ...(typeof reasoning === 'string' && reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
      },
      jsonCandidate,
      topLevelKeys,
      operationCount: rawOperations.length,
      sourceBlockIds: rawOperations.map((block) => (block as { sourceBlockId: string }).sourceBlockId),
      jsonParseSuccess: true,
      schemaValidationSuccess: true,
      semanticValidationSuccess: true,
    };
  } catch (error) {
    return {
      parsed: null,
      jsonCandidate,
      topLevelKeys: [],
      operationCount: 0,
      sourceBlockIds: [],
      jsonParseSuccess: false,
      schemaValidationSuccess: false,
      semanticValidationSuccess: false,
      rejectionStage: 'json_parse',
      rejectionReason: error instanceof Error ? error.message : 'JSON.parse failed.',
    };
  }
}

export function parseProposalBlocks(content: string): { blocks: Omit<Block, 'id'>[]; reasoning?: string } | null {
  const parsed = inspectProposalResponse(content).parsed;
  return parsed ? { blocks: parsed.blocks, reasoning: parsed.reasoning } : null;
}

function resolveTargetBlocks(intent: ProposalIntent, original: Block[]): Block[] {
  const prioritized = new Set<ElementType>(['dialogue', 'action', 'parenthetical']);
  const editableByIntent: Record<ProposalIntent, ElementType[]> = {
    improve_dialogue: ['dialogue'],
    add_subtext: ['dialogue'],
    make_visual: ['action'],
    tighten: ['action', 'dialogue', 'parenthetical'],
    alternatives: ['dialogue', 'action', 'parenthetical'],
    character_voice: ['dialogue', 'character'],
    custom: ['scene_heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'general'],
  };
  const allowed = editableByIntent[intent] ?? ['dialogue'];
  const matches = original.filter((block) => allowed.includes(block.type));
  if (matches.length > 0) return matches;
  const fallback = original.filter((block) => prioritized.has(block.type));
  return fallback.length > 0 ? fallback : original;
}

function editableTypesForIntent(intent: ProposalIntent): ElementType[] {
  const types: Record<ProposalIntent, ElementType[]> = {
    improve_dialogue: ['dialogue'],
    add_subtext: ['dialogue'],
    make_visual: ['action'],
    tighten: ['action', 'dialogue', 'parenthetical'],
    alternatives: ['dialogue', 'action', 'parenthetical'],
    character_voice: ['dialogue', 'character'],
    custom: [...VALID_BLOCK_TYPES],
  };
  return types[intent] ?? ['dialogue'];
}

export function validateProposal(
  proposal: ScreenplayProposal,
  currentBlocks: Block[],
  currentSourceRevision: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (proposal.sourceRevision && currentSourceRevision && proposal.sourceRevision !== currentSourceRevision) {
    errors.push('Stale source revision.');
  }
  if (!proposal.operations.length) {
    errors.push('No proposal operations supplied.');
  }
  const currentIndex = new Map(currentBlocks.map((block) => [block.id, block]));
  const seen = new Set<string>();
  for (const operation of proposal.operations) {
    if (!operation.sourceBlockId || seen.has(operation.sourceBlockId)) {
      errors.push(`Duplicate or missing sourceBlockId: ${operation.sourceBlockId ?? 'unknown'}.`);
      continue;
    }
    seen.add(operation.sourceBlockId);
    const source = currentIndex.get(operation.sourceBlockId);
    if (!source) {
      errors.push(`Unknown source block: ${operation.sourceBlockId}.`);
      continue;
    }
    if (operation.type !== source.type) {
      errors.push(`Semantic type mismatch for ${operation.sourceBlockId}.`);
    }
    if (!editableTypesForIntent(proposal.intent).includes(source.type)) {
      errors.push(`Operation targets an unsupported ${source.type} block for ${proposal.intent}.`);
    }
    if (operation.text.trim() === source.content.trim()) {
      errors.push(`No meaningful change for ${operation.sourceBlockId}.`);
    }
  }
  if (proposal.sourceBlockIds.length && proposal.sourceBlockIds.some((id) => !currentIndex.has(id))) {
    errors.push('Selection references a block not present in the current scene.');
  }
  if (proposal.noOp) {
    errors.push('Proposal is a no-op.');
  }
  if (proposal.proposalError) {
    errors.push(proposal.proposalError);
  }
  return { valid: errors.length === 0, errors };
}

export function createScreenplayProposal(
  selection: ScreenplaySelection,
  intent: ProposalIntent,
  original: Block[],
  parsed: { blocks: Omit<Block, 'id'>[]; operations?: ParsedProposalOperation[]; reasoning?: string },
): ScreenplayProposal {
  const targetedOriginal = resolveTargetBlocks(intent, original);
  const sourceIds = new Set(targetedOriginal.map((block) => block.id));
  const preservedBlockIds = selection.selectedBlockIds.filter((blockId) => !sourceIds.has(blockId));
  const suggested = parsed.blocks.map((block) => ({ ...block, id: uid() }));
  const explicitOperations = parsed.operations ?? [];
  const operations: ProposalOperation[] = explicitOperations.map((operation) => ({
      operation: 'replace',
      sourceBlockId: operation.sourceBlockId,
      type: operation.type,
      text: operation.text,
    }));
  const duplicateSourceIds = explicitOperations.length > 0
    && new Set(explicitOperations.map((operation) => operation.sourceBlockId)).size !== explicitOperations.length;
  const structureError = duplicateSourceIds
    ? 'Co-Drafter returned an invalid block structure. Try again.'
    : targetedOriginal.length > 0 && !explicitOperations.length
    ? 'Co-Drafter returned an invalid block structure. Try again.'
    : undefined;

  const noOp = operations.length === 0 || operations.every((operation) => {
    const source = targetedOriginal.find((block) => block.id === operation.sourceBlockId);
    return !!source && source.type === operation.type && source.content.trim() === operation.text.trim();
  });

  return {
    id: uid(),
    sceneId: selection.sceneId,
    sourceBlockIds: targetedOriginal.map((block) => block.id),
    sourceRevision: selection.sourceRevision,
    intent,
    original: targetedOriginal,
    suggested,
    explanation: parsed.reasoning,
    operations,
    preservedBlockIds,
    noOp,
    proposalError: structureError ?? (noOp ? "Co-Drafter didn't produce a meaningful change." : undefined),
    createdAt: new Date().toISOString(),
  };
}