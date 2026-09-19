import type { Project } from '@/lib/project';
import type { ProposalIntent, ProposalResponseInspection, ScreenplaySelection } from '@/lib/ai/screenplay-proposal';

const proposalScopeByIntent: Record<ProposalIntent, string> = {
  improve_dialogue: 'Make this dialogue more natural and character-appropriate while preserving intent and language mixture.',
  add_subtext: 'Make the intended meaning more implied through natural wording while preserving intent and language mixture.',
  make_visual: 'Rewrite this action using observable images and actions. Do not add unrelated story information.',
  tighten: 'Make this block shorter and cleaner while preserving meaning. If already concise, make a useful wording improvement.',
  alternatives: 'Generate restrained, useful variations of this block.',
  character_voice: 'Strengthen the established character voice without changing the underlying meaning.',
  custom: 'Follow the user instruction directly while preserving screenplay semantics.',
};

export const ALTERNATIVES_SCHEMA_REQUIREMENTS = `IMPORTANT:
- \`alternatives\` MUST contain EXACTLY 3 objects.
- Do not return 1 alternative.
- Do not return 2 alternatives.
- Each alternative contains exactly ONE replace operation.
- All 3 replacement texts must differ from the source.
- All 3 replacement texts must also differ from each other.
- Return JSON only.`;

export const ALTERNATIVES_SCHEMA_SHAPE = `{
  "alternatives": [
    {
      "operations": [
        {
          "operation": "replace",
          "sourceBlockId": "<SOURCE_ID>",
          "type": "<SOURCE_TYPE>",
          "text": "<REWRITE_1>"
        }
      ]
    },
    {
      "operations": [
        {
          "operation": "replace",
          "sourceBlockId": "<SOURCE_ID>",
          "type": "<SOURCE_TYPE>",
          "text": "<REWRITE_2>"
        }
      ]
    },
    {
      "operations": [
        {
          "operation": "replace",
          "sourceBlockId": "<SOURCE_ID>",
          "type": "<SOURCE_TYPE>",
          "text": "<REWRITE_3>"
        }
      ]
    }
  ]
}`;

export function buildProposalProviderInstruction(displayMessage: string, intent: ProposalIntent, selection?: ScreenplaySelection, sourceBlocks?: Array<{ id: string; type: string; content: string }>) {
  const editableTypes = intent === 'improve_dialogue' || intent === 'add_subtext' || intent === 'character_voice'
    ? new Set(['dialogue'])
    : intent === 'make_visual'
      ? new Set(['action'])
      : intent === 'tighten' || intent === 'alternatives'
        ? new Set(['action', 'dialogue', 'parenthetical'])
        : null;
  const editableBlocks = (sourceBlocks ?? []).filter((block) => !editableTypes || editableTypes.has(block.type));
  const sourceBlock = editableBlocks[0];
  const selectedBlocks = selection && sourceBlock
    ? ` SOURCE_BLOCK: ${JSON.stringify({ id: sourceBlock.id, type: sourceBlock.type, text: sourceBlock.content })}. Source revision: ${selection.sourceRevision}.`
    : '';
  if (intent === 'alternatives') {
    const cleanedMessage = displayMessage.replace(/^(Suggest 2 or 3 concise alternatives|Generate exactly 3 alternatives)\.?$/gi, '').trim();
    const prefix = cleanedMessage ? `${cleanedMessage}. ` : '';
    return `${prefix}Return EXACTLY 3 alternatives. Generate EXACTLY 3 genuinely different rewrites of the supplied block. Every replacement must differ textually from the source, preserve meaning, language mixture including romanized Telugu/Tenglish, tone, and screenplay function, and make only a small useful variation. For a minimal action such as "Screen on avutundi.", vary visual phrasing, rhythm, or concise physical detail without inventing a major event. Never return the source unchanged. No commentary, markdown, planning, or schema discussion before or after JSON.

${ALTERNATIVES_SCHEMA_REQUIREMENTS}

${ALTERNATIVES_SCHEMA_SHAPE}${selectedBlocks ? `\n\n${selectedBlocks.trim()}` : ''}`;
  }
  return `${displayMessage}. ${proposalScopeByIntent[intent]} Return ONLY valid JSON: {"operations":[{"operation":"replace","sourceBlockId":"EXACT SOURCE BLOCK ID","type":"EXACT SEMANTIC TYPE","text":"COMPLETE REPLACEMENT TEXT"}]}. Use exactly one replace operation for the supplied block. Preserve its stable sourceBlockId and semantic type. Do not explain, plan, self-critique, discuss schema, add commentary, or use markdown. Do not add unsupported facts.${selectedBlocks}`;
}

export function buildProposalRepairInstruction(selection: ScreenplaySelection, sourceBlocks: Array<{ id: string; type: string; content: string }>, noOp = false) {
  const editableBlocks = sourceBlocks
    .filter((block) => ['action', 'dialogue', 'parenthetical'].includes(block.type))
    .map((block) => ({ id: block.id, type: block.type, text: block.content }));
  return `Your previous replacement failed validation. ${noOp ? 'It was identical to the source. Write a small but genuine wording change now; do not return the source unchanged.' : 'Return the requested transformation directly.'} Preserve meaning, character intent, source language/style, and Tenglish mixture. Return ONLY this JSON shape with exactly one operation: {"operations":[{"operation":"replace","sourceBlockId":"EXACT SOURCE BLOCK ID","type":"EXACT SEMANTIC TYPE","text":"COMPLETE REPLACEMENT TEXT"}]}. Keep the same sourceBlockId and type. No analysis, planning, schema discussion, markdown, or commentary. SOURCE_BLOCK: ${JSON.stringify(editableBlocks[0] ?? null)}. Source revision: ${selection.sourceRevision}.`;
}

export function buildAlternativesRepairInstruction(
  selection: ScreenplaySelection,
  sourceBlocks: Array<{ id: string; type: string; content: string }>,
  failureReason?: string | null,
  candidateCount?: number,
) {
  const editable = sourceBlocks.filter((block) => ['action', 'dialogue', 'parenthetical'].includes(block.type)).map((block) => ({ id: block.id, type: block.type, text: block.content }));
  const sourceBlock = editable[0];
  const actualId = sourceBlock?.id ?? '<SOURCE_ID>';
  const actualType = sourceBlock?.type ?? '<SOURCE_TYPE>';

  let previousNote: string;
  if (candidateCount === 2) {
    previousNote = 'Your previous response contained only 2 alternatives.';
  } else if (candidateCount !== undefined && candidateCount > 3) {
    previousNote = `Your previous response contained ${candidateCount} alternatives.`;
  } else if (failureReason?.includes('unchanged')) {
    previousNote = 'Your previous replacement was identical to the source.';
  } else if (failureReason?.includes('distinct')) {
    previousNote = 'Your previous response contained duplicate alternatives.';
  } else {
    previousNote = 'Your previous response contained only 1 alternative.';
  }

  return `${previousNote}

Return EXACTLY 3 alternatives.

Each alternative must contain exactly one replace operation for:
sourceBlockId: ${actualId}
type: ${actualType}

All 3 replacement texts must differ from the source and from each other.

${ALTERNATIVES_SCHEMA_REQUIREMENTS}

${ALTERNATIVES_SCHEMA_SHAPE}

Return JSON only.
${sourceBlock ? `\nSOURCE_BLOCK: ${JSON.stringify(sourceBlock)}. Source revision: ${selection.sourceRevision}.` : ''}`;
}

export function buildAlternativesEmptyContentRepairInstruction(
  selection: ScreenplaySelection,
  sourceBlocks: Array<{ id: string; type: string; content: string }>,
) {
  const editable = sourceBlocks.filter((block) => ['action', 'dialogue', 'parenthetical'].includes(block.type)).map((block) => ({ id: block.id, type: block.type, text: block.content }));
  const sourceBlock = editable[0];
  const actualId = sourceBlock?.id ?? '<SOURCE_ID>';
  const actualType = sourceBlock?.type ?? '<SOURCE_TYPE>';

  return `The previous response did not provide usable final JSON.

Return EXACTLY 3 alternatives.

Each alternative must contain exactly one replace operation for:
sourceBlockId: ${actualId}
type: ${actualType}

All 3 replacement texts must differ from the source and from each other.

${ALTERNATIVES_SCHEMA_REQUIREMENTS}

${ALTERNATIVES_SCHEMA_SHAPE}

Return JSON only.
${sourceBlock ? `\nSOURCE_BLOCK: ${JSON.stringify(sourceBlock ?? null)}. Source revision: ${selection.sourceRevision}.` : ''}`;
}

export function classifyAlternativeProviderOutput(content: string, reasoningContent = '', finishReason?: string, maxCompletionTokens = 4096, completionTokens?: number) {
  if (content.trim().length > 0 && finishReason !== 'length') return null;
  return {
    rejectionStage: 'provider_output' as const,
    rejectionCode: finishReason === 'length' ? 'SARVAM_OUTPUT_TRUNCATED' : 'SARVAM_EMPTY_FINAL_CONTENT',
    rejectionReason: finishReason === 'length' ? 'Sarvam exhausted the completion budget before emitting complete final content.' : 'Sarvam returned reasoning content without a final assistant response.',
    finishReason,
    contentLength: content.length,
    reasoningContentLength: reasoningContent.length,
    completionTokens,
    maxCompletionTokens,
  };
}

export function shouldRetryAlternativeProviderOutput(content: string, reasoningContent: string, finishReason: string | undefined, retryAttempt: number) {
  return retryAttempt === 0 && content.trim().length === 0 && reasoningContent.trim().length > 0;
}

export function shouldRetryProposalResponse(
  inspection: ProposalResponseInspection | null,
  validationErrors: string[] = [],
  noOp = false,
  finishReason?: string,
  responseContent = '',
) {
  if (!inspection || (finishReason === 'length' && !responseContent.trim())) return false;
  return inspection.rejectionStage === 'schema'
    || inspection.rejectionStage === 'semantic'
    || noOp
    || validationErrors.some((error) => /sourceBlockId|Unknown source block|Semantic type mismatch|unsupported|meaningful change|no-op/i.test(error));
}

export function appliedToSceneMessage(project: Project, sceneId: string) {
  const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
  const scene = project.scenes[sceneIndex];
  if (!scene) return 'Applied to screenplay.';
  const heading = scene.blocks.find((block) => block.type === 'scene_heading')?.content;
  return `Applied to Scene ${sceneIndex + 1}${heading ? ` · ${heading}` : ''}.`;
}