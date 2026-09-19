import type { Block } from '../project.ts';
import { isCoDrafterEditableBlock } from './screenplay-proposal.ts';
import type { ScreenplaySelection } from './screenplay-proposal.ts';

export function resolveCoDrafterEditableBlocks(selection: ScreenplaySelection | null | undefined, blocks: Block[]) {
  if (!selection) return [];
  const selectedIds = new Set(selection.selectedBlockIds);
  return blocks.filter((block) => selectedIds.has(block.id) && isCoDrafterEditableBlock(block));
}
