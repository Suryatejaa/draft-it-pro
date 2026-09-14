import assert from 'node:assert/strict';
import {
  blankProject,
  newScene,
  reconcile,
  normalizeProject,
  parseSceneHeading,
} from '../lib/project.ts';
import {
  entity,
  sourceLink,
  callSheetData,
  needsReview,
  copyProjectSnapshot,
} from '../lib/production.ts';
const p = blankProject('Malformed scene regression', 'Short Film');
const title = {
  ...newScene(),
  heading: 'INT. TITLE CARD - DAY',
  blocks: [
    { id: 'title', type: 'scene_heading', content: 'INT. TITLE CARD - DAY' },
    {
      id: 'title-action',
      type: 'action',
      content: 'Preserve the title card text',
    },
  ],
};
const number = {
  ...newScene(),
  heading: '4.',
  blocks: [
    { id: 'number', type: 'scene_heading', content: '4.' },
    { id: 'sahithi', type: 'character', content: 'SAHITHI' },
  ],
};
const cue = {
  ...newScene(),
  heading: 'SAHITHI',
  blocks: [
    { id: 'cue', type: 'character', content: 'SAHITHI' },
    { id: 'dialogue', type: 'dialogue', content: 'Keep this dialogue' },
  ],
};
const disguised = {
  ...newScene(),
  heading: 'INT. ROOM - DAY',
  blocks: [{ id: 'action', type: 'action', content: 'INT. ROOM - DAY' }],
};
const valid = {
  ...newScene(),
  heading: 'INT./EXT. MEMORY TRAIN (DREAM) - CONTINUOUS',
  blocks: [
    {
      id: 'valid',
      type: 'scene_heading',
      content: 'INT./EXT. MEMORY TRAIN (DREAM) - CONTINUOUS',
    },
  ],
};
p.scenes = [title, number, cue, disguised, valid];
const item = {
  ...entity(p.id),
  ...sourceLink(p, [title.id]),
  episodeId: p.id,
  sceneId: title.id,
  category: 'props',
  name: 'Manually specified title prop',
  description: 'Must survive',
  status: 'needed',
  notes: 'Manual notes',
  source: 'manual',
  confirmed: true,
};
p.breakdownItems = [item];
const day = {
  ...entity(p.id),
  ...sourceLink(p, [title.id, valid.id]),
  date: '2026-10-02',
  number: 1,
  scheduledSceneIds: [title.id, valid.id],
  shootingLocationIds: [],
  generalCallTime: '07:00',
  estimatedWrapTime: '18:00',
  notes: '',
  status: 'draft',
};
p.shootDays = [day];
const result = normalizeProject(p);
assert.deepEqual(
  result.scenes.map((s) => s.id),
  [valid.id],
);
assert.equal(result.sceneQuarantine.length, 4);
assert.deepEqual(
  result.sceneQuarantine.map((q) => q.scene),
  [title, number, cue, disguised],
  'Original records and all content preserved',
);
assert.deepEqual(result.breakdownItems, [item]);
assert.deepEqual(result.shootDays, [day]);
assert.ok(needsReview(result, item, [title.id]));
assert.deepEqual(
  callSheetData(result, day).scenes.map((s) => s.id),
  [valid.id],
);
assert.deepEqual(
  callSheetData(result, day).requirements,
  [],
  'Invalid source requirements cannot leak into call sheets',
);
assert.deepEqual(normalizeProject(result), result, 'Quarantine idempotent');
assert.equal(copyProjectSnapshot(result).sceneQuarantine[0].scene.id, title.id);
for (const heading of [
  'INT-EXT. TRAIN - NIGHT',
  'EXT. THE VOID (DREAM) - TIMELESS',
  'INT. PG / LIVING AREA - LATER',
])
  assert.ok(parseSceneHeading(heading), heading);
for (const heading of [
  'INT. TITLE CARD - DAY',
  '4.',
  'SAHITHI',
  'CUT TO:',
  'TITLE CARD',
  '',
])
  assert.equal(parseSceneHeading(heading), undefined, heading);
const repaired = {
  ...title,
  blocks: title.blocks.map((b) =>
    b.id === 'title' ? { ...b, content: 'INT. EDIT SUITE - DAY' } : b,
  ),
};
const restored = reconcile({
  ...result,
  scenes: [...result.scenes, repaired],
  sceneQuarantine: result.sceneQuarantine.filter(
    (q) => q.scene.id !== title.id,
  ),
});
assert.ok(restored.scenes.some((s) => s.id === title.id));
assert.equal(
  restored.breakdownItems[0].sceneId,
  title.id,
  'Repair reconnects the same manual record',
);
console.log(
  'PASS: exact malformed headings, cue/action-only scenes, preserved quarantine, safe planning, repair by stable ID, stylized headings.',
);
