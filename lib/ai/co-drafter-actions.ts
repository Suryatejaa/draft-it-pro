import type { ElementType } from '../project.ts';
import type { ProposalIntent } from './screenplay-proposal.ts';

export type CoDrafterAction = {
  id: ProposalIntent | 'custom';
  label: string;
  prompt: string;
  types: ElementType[];
};

export const CO_DRAFTER_ACTIONS: CoDrafterAction[] = [
  { id: 'alternatives', label: 'Alternatives', prompt: 'Suggest alternatives', types: ['action', 'dialogue', 'parenthetical'] },
  { id: 'tighten', label: 'Tighten', prompt: 'Tighten this selection', types: ['action', 'dialogue', 'parenthetical'] },
  { id: 'make_visual', label: 'Make Visual', prompt: 'Make this more visual', types: ['action'] },
  { id: 'add_subtext', label: 'Add Subtext', prompt: 'Add subtext', types: ['dialogue'] },
  { id: 'improve_dialogue', label: 'Improve Dialogue', prompt: 'Improve dialogue', types: ['dialogue'] },
  { id: 'character_voice', label: 'Character Voice', prompt: 'Check character voice', types: ['dialogue'] },
];

export function getCompatibleCoDrafterActions(type: ElementType) {
  return CO_DRAFTER_ACTIONS.filter((action) => action.types.includes(type));
}

export function getCoDrafterLaunchStep(eligibleCount: number): 0 | 1 | 2 {
  return eligibleCount === 0 ? 0 : eligibleCount === 1 ? 2 : 1;
}

export function shouldConsumeInitialAction(lastConsumedNonce: number | null, nonce: number) {
  return lastConsumedNonce !== nonce;
}
