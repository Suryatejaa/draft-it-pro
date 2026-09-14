import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {
  seeds,
  normalizeProject,
  reconcile,
  newScene,
  blankProject,
  normalizeCharacterName,
  parseSceneHeading,
  createSeries,
} from '../lib/project.ts';
import {
  entity,
  sourceLink,
  createShot,
  extractBreakdown,
  migrateProjectSnapshot,
  copyProjectSnapshot,
  projectFileCopies,
  productionKeys,
  needsReview,
  reviewSource,
  assignScene,
  coverage,
  callSheetData,
  callSheetRevision,
  callSheetSnapshot,
  shotRevision,
  validateProductionSnapshot,
} from '../lib/production.ts';

function fixture() {
  const p = normalizeProject(seeds()[0]);
  const scene = p.scenes[0],
    character = p.characters[0],
    storyLocation = p.locations.find((l) => l.id === scene.locationId);
  const cast = {
    ...entity(p.id),
    name: 'Siri Chandana',
    phone: '123',
    email: 'actor@example.test',
    notes: 'Keep contract notes',
    availability: [],
    contractStatus: 'signed',
    documents: [],
    assignedCharacterIds: [character.id],
  };
  character.castMemberId = cast.id;
  character.castingStatus = 'cast';
  p.castMembers = [cast];
  const location = {
    ...entity(p.id),
    name: 'Physical hostel',
    address: 'Test address',
    lat: 17.4,
    lng: 78.4,
    contactName: 'Manager',
    contactPhone: '555',
    availability: [],
    permissionStatus: 'approved',
    photos: [],
    videos: [],
    floorPlanFiles: [],
    recceNotes: 'Power at entrance',
  };
  storyLocation.shootingLocationId = location.id;
  p.shootingLocations = [location];
  const file = {
    id: 'file-one',
    name: 'reference.pdf',
    path: `users/test-user/projects/${p.id}/files/file-one`,
    mimeType: 'application/pdf',
    size: 3,
  };
  const asset = {
    ...entity(p.id),
    name: 'Red bag',
    type: 'prop',
    description: 'Manual description',
    photos: [],
    files: [file],
    linkedSceneIds: [scene.id],
    linkedCharacterIds: [character.id],
    linkedLocationIds: [storyLocation.id],
    continuityNotes: 'Strap on left',
    ownership: 'owned',
    status: 'ready',
    estimatedCost: 100,
    actualCost: 80,
    notes: '',
  };
  p.assets = [asset];
  p.breakdownItems = [
    {
      ...entity(p.id),
      ...sourceLink(p, [scene.id]),
      episodeId: p.id,
      sceneId: scene.id,
      category: 'props',
      name: 'Bag',
      description: 'Never overwrite',
      linkedAssetId: asset.id,
      linkedCharacterId: character.id,
      linkedLocationId: storyLocation.id,
      status: 'ready',
      notes: 'Manual',
      source: 'manual',
      confirmed: true,
    },
  ];
  const look = {
    ...entity(p.id),
    characterId: character.id,
    name: 'Interview',
    storyDay: 1,
    description: '',
    wardrobeNotes: 'Blue',
    hairNotes: 'Tied',
    makeupNotes: 'Natural',
    referenceImages: [],
    linkedSceneIds: [scene.id],
    continuityNotes: 'Keep jacket',
  };
  p.characterLooks = [look];
  character.defaultLookId = look.id;
  const shot = {
    ...createShot(p, scene.id),
    title: 'Interview',
    description: 'Manual shot',
    subjectIds: [character.id],
    coveredScriptBlockIds: [scene.blocks.find((b) => b.type === 'action').id],
  };
  const panel = {
    id: 'panel-new',
    sceneId: scene.id,
    shotId: shot.id,
    size: 'wide',
    angle: 'eye_level',
    lens: '35mm',
    movement: 'static',
    duration: 4,
    description: 'Manual panel',
    customPrompt: 'Do not replace',
    image: 'data:image/png;base64,AAAA',
    status: 'Ready',
    ...sourceLink(p, [scene.id]),
  };
  shot.storyboardPanelId = panel.id;
  panel.shotRevision = shotRevision(shot);
  p.shots = [shot];
  p.panels = [panel];
  const day = {
    ...entity(p.id),
    ...sourceLink(p, [scene.id]),
    date: '2026-10-01',
    number: 1,
    shootingLocationIds: [location.id],
    scheduledSceneIds: [scene.id],
    generalCallTime: '07:00',
    estimatedWrapTime: '18:00',
    notes: 'Bring rain cover',
    status: 'draft',
  };
  p.shootDays = [day];
  p.continuityRecords = [
    {
      ...entity(p.id),
      ...sourceLink(p, [scene.id]),
      sceneId: scene.id,
      characterId: character.id,
      assetId: asset.id,
      storyDay: 1,
      shootDayId: day.id,
      characterLookId: look.id,
      wardrobe: 'Blue',
      hair: 'Tied',
      makeup: 'Natural',
      propsState: 'Bag open',
      objectState: '',
      injuriesDirtWetness: 'Dry',
      foodDrinkState: 'Full cup',
      screenDirectionNotes: 'Left',
      photos: [],
      previousSceneId: p.scenes[1].id,
      nextSceneId: p.scenes[2].id,
      notes: 'Keep this',
    },
  ];
  p.crewMembers = [
    {
      ...entity(p.id),
      name: 'Camera person',
      department: 'Camera',
      role: 'Operator',
      phone: '',
      email: '',
      availability: [],
      notes: '',
    },
  ];
  p.documents = [
    {
      ...entity(p.id),
      name: 'Permission',
      type: 'location_permission',
      files: [file],
      notes: '',
      sceneId: scene.id,
      castMemberId: cast.id,
      shootingLocationId: location.id,
      shootDayId: day.id,
    },
  ];
  p.budget = [
    {
      ...entity(p.id),
      name: 'Bag',
      category: 'Props',
      estimated: 100,
      actual: 80,
      assetId: asset.id,
      castMemberId: cast.id,
      shootingLocationId: location.id,
      shootDayId: day.id,
    },
  ];
  p.callSheets = [
    {
      ...entity(p.id),
      sourceRevision: callSheetRevision(p, day),
      sourceSnapshot: callSheetSnapshot(p, day),
      sourceUpdatedAt: p.updatedAt,
      shootDayId: day.id,
      productionContact: 'Producer 555',
      notes: 'Manual notes',
      castCallTimes: { [cast.id]: '08:00' },
    },
  ];
  return p;
}
function verifyGraph(p) {
  const has = (key, id) => p[key].some((r) => r.id === id);
  for (const key of productionKeys)
    for (const r of p[key])
      assert.equal(r.projectId, p.id, `${key} project scope`);
  for (const c of p.characters) {
    if (c.castMemberId)
      assert.ok(has('castMembers', c.castMemberId), 'Character → cast');
    if (c.defaultLookId) assert.ok(has('characterLooks', c.defaultLookId));
  }
  for (const c of p.castMembers)
    for (const id of c.assignedCharacterIds) assert.ok(has('characters', id));
  for (const l of p.locations)
    if (l.shootingLocationId)
      assert.ok(
        has('shootingLocations', l.shootingLocationId),
        'Story → shooting location',
      );
  for (const shot of p.shots) {
    assert.ok(has('scenes', shot.sceneId), 'Shot → scene');
    for (const id of shot.coveredScriptBlockIds)
      assert.ok(
        p.scenes
          .find((s) => s.id === shot.sceneId)
          .blocks.some((b) => b.id === id),
        'Coverage → block',
      );
    if (shot.storyboardPanelId)
      assert.ok(has('panels', shot.storyboardPanelId));
  }
  for (const panel of p.panels)
    assert.ok(has('shots', panel.shotId), 'Panel → shot');
  for (const b of p.breakdownItems) {
    assert.equal(b.episodeId, p.id);
    assert.ok(has('scenes', b.sceneId));
    for (const [field, key] of [
      ['linkedAssetId', 'assets'],
      ['linkedCharacterId', 'characters'],
      ['linkedLocationId', 'locations'],
    ])
      if (b[field]) assert.ok(has(key, b[field]), `Breakdown → ${key}`);
  }
  for (const d of p.shootDays) {
    for (const id of d.scheduledSceneIds)
      assert.ok(has('scenes', id), 'Day → scene');
    for (const id of d.shootingLocationIds)
      assert.ok(has('shootingLocations', id));
  }
  for (const c of p.continuityRecords)
    for (const [field, key] of [
      ['sceneId', 'scenes'],
      ['characterId', 'characters'],
      ['assetId', 'assets'],
      ['shootDayId', 'shootDays'],
      ['characterLookId', 'characterLooks'],
      ['previousSceneId', 'scenes'],
      ['nextSceneId', 'scenes'],
    ])
      if (c[field]) assert.ok(has(key, c[field]), `Continuity → ${key}`);
  for (const c of p.callSheets) assert.ok(has('shootDays', c.shootDayId));
  for (const d of [...p.documents, ...p.budget])
    for (const [field, key] of [
      ['sceneId', 'scenes'],
      ['assetId', 'assets'],
      ['castMemberId', 'castMembers'],
      ['shootingLocationId', 'shootingLocations'],
      ['shootDayId', 'shootDays'],
    ])
      if (d[field]) assert.ok(has(key, d[field]));
}
const p = fixture();
const original = JSON.stringify(p);
verifyGraph(p);
validateProductionSnapshot(p);
const copy = copyProjectSnapshot(p);
verifyGraph(copy);
validateProductionSnapshot(copy);
assert.notEqual(copy.id, p.id);
for (const key of [
  'scenes',
  'characters',
  'locations',
  'panels',
  ...productionKeys,
])
  assert.deepEqual(
    copy[key].map((r) => r.id),
    p[key].map((r) => r.id),
    `${key} IDs preserved`,
  );
assert.ok(
  !JSON.stringify(copy).includes(p.id),
  'No source project scope anywhere in copied snapshot, including file paths and saved review history',
);
assert.equal(copy.panels[0].customPrompt, 'Do not replace');
assert.equal(
  copy.callSheets[0].sourceRevision,
  callSheetRevision(copy, copy.shootDays[0]),
  'Current call sheet remains current after scope rebase',
);
assert.equal(
  projectFileCopies(p, copy).length,
  1,
  'Repeated reference to one file copied once',
);
assert.ok(projectFileCopies(p, copy)[0].targetPath.includes(copy.id));
copy.assets[0].notes = 'copy only';
assert.equal(JSON.stringify(p), original, 'No mutation of source project');
const series = createSeries('Series', 1);
series.episodes = [p];
const seriesCopy = copyProjectSnapshot(series);
verifyGraph(seriesCopy.episodes[0]);
assert.ok(!JSON.stringify(seriesCopy).includes(series.id));
assert.ok(!JSON.stringify(seriesCopy).includes(p.id));
assert.ok(
  seriesCopy.episodes[0].assets[0].files[0].path.includes(seriesCopy.id),
  'Episode attachments use root storage scope',
);
console.log(
  'PASS: all 10 copy checks; nested episodes, files, call sheets and budgets retain valid links without source-project scope.',
);

const changed = reconcile({
  ...p,
  scenes: p.scenes.map((s, i) =>
    i
      ? s
      : {
          ...s,
          storyDay: 2,
          blocks: s.blocks.map((b) =>
            b.type === 'action' ? { ...b, content: 'Changed action' } : b,
          ),
        },
  ),
});
for (const key of ['shots', 'breakdownItems', 'continuityRecords']) {
  assert.ok(needsReview(changed, changed[key][0], [p.scenes[0].id]), key);
  assert.deepEqual(
    changed[key],
    p[key],
    'Screenplay changes preserve production',
  );
}
assert.ok(
  needsReview(changed, p.shootDays[0], p.shootDays[0].scheduledSceneIds),
);
assert.ok(needsReview(changed, p.panels[0], [p.scenes[0].id]));
assert.notEqual(
  callSheetRevision(changed, p.shootDays[0]),
  p.callSheets[0].sourceRevision,
);
const reviewed = reviewSource(changed, p.shots[0], [p.scenes[0].id]);
assert.equal(reviewed.description, p.shots[0].description);
assert.ok(!needsReview(changed, reviewed, [p.scenes[0].id]));
const reordered = { ...p, scenes: [...p.scenes].reverse() };
assert.ok(
  !needsReview(reordered, p.shots[0], [p.scenes[0].id]),
  'Scene reorder is not a source edit',
);
assert.ok(
  needsReview({ ...p, scenes: p.scenes.slice(1) }, p.shots[0], [
    p.scenes[0].id,
  ]),
  'Removed scene triggers review',
);
const scheduled = assignScene(p, p.scenes[1].id, p.shootDays[0].id);
assert.deepEqual(scheduled.scenes, p.scenes);
assert.deepEqual(scheduled.shootDays[0].scheduledSceneIds, [
  p.scenes[0].id,
  p.scenes[1].id,
]);
assert.equal(coverage(p, p.scenes[0].id)[0].shots[0].id, p.shots[0].id);
assert.ok(
  coverage(p, p.scenes[0].id).some((b) => b.shots.length === 0),
  'Uncovered dialogue is visible',
);
const derived = callSheetData(p, p.shootDays[0]);
assert.equal(derived.cast[0].id, p.castMembers[0].id);
assert.equal(derived.locations[0].id, p.shootingLocations[0].id);
assert.equal(derived.requirements[0].linkedAssetId, p.assets[0].id);
assert.deepEqual(
  migrateProjectSnapshot(migrateProjectSnapshot(p)),
  migrateProjectSnapshot(p),
  'Migration is idempotent',
);
assert.throws(
  () => migrateProjectSnapshot({ ...p, schemaVersion: 999 }),
  /newer|Unsupported/,
);
assert.throws(
  () =>
    migrateProjectSnapshot({
      ...p,
      shots: [{ ...p.shots[0], projectId: 'other' }],
    }),
  /scope/,
);
const staleCopy = copyProjectSnapshot(changed);
assert.notEqual(
  staleCopy.callSheets[0].sourceRevision,
  callSheetRevision(staleCopy, staleCopy.shootDays[0]),
  'Copy does not approve stale work',
);
console.log(
  'PASS: revisions, manual-data preservation, missing-source review, coverage, derived call sheets, independent scheduling and migration guards.',
);

assert.equal(normalizeCharacterName('  Sirisha (V.O.) (CONT’D)  '), 'SIRISHA');
assert.equal(normalizeCharacterName('SIRISHA O.S.'), 'SIRISHA');
for (const cue of ['INT. ROOM - DAY', 'TITLE CARD', 'MONTAGE:', 'CUT TO:'])
  assert.equal(normalizeCharacterName(cue), '');
assert.equal(parseSceneHeading('INT-EXT. TRAIN - NIGHT').name, 'TRAIN');
assert.equal(parseSceneHeading('INT. PG - ROOM - DAY').name, 'PG - ROOM');
assert.equal(parseSceneHeading('TITLE CARD'), undefined);
const bad = blankProject('Extraction', 'Short Film');
const s = newScene();
s.blocks = [
  { id: 'a', type: 'action', content: 'RANDOM ACTOR / INT. FAKE - DAY' },
  { id: 'b', type: 'character', content: 'INT. WRONG - NIGHT' },
  { id: 'c', type: 'character', content: 'SIRISHA (V.O.)' },
  { id: 'd', type: 'character', content: "sirisha (CONT'D)" },
  { id: 'e', type: 'scene_heading', content: 'TITLE CARD' },
];
bad.scenes = [s];
const extracted = reconcile(bad);
assert.equal(extracted.characters.length, 0);
assert.equal(extracted.locations.length, 0);
assert.equal(extracted.scenes.length, 0);
assert.equal(extracted.sceneQuarantine.length, 1);
const items = extractBreakdown(p, p.scenes[0]);
assert.deepEqual(
  extractBreakdown(items, p.scenes[0]).breakdownItems,
  items.breakdownItems,
  'Extraction idempotent',
);
console.log(
  'PASS: semantic-only extraction, cue normalization, invalid label rejection, location parsing and safe breakdown extraction.',
);

const compiled = new URL(
  '../lib/.production-import-check.mjs',
  import.meta.url,
);
fs.writeFileSync(
  compiled,
  ts.transpileModule(
    fs
      .readFileSync(new URL('../lib/imports.ts', import.meta.url), 'utf8')
      .replace("from './project'", "from './project.ts'"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText,
);
try {
  const { prepareImport } = await import(compiled.href);
  const legacy = seeds()[0];
  delete legacy.schemaVersion;
  const restoredLegacy = prepareImport(
    JSON.stringify(legacy),
    'Export',
    p,
  ).project;
  assert.notEqual(restoredLegacy.id, legacy.id);
  assert.equal(restoredLegacy.schemaVersion, 2);
  assert.equal(restoredLegacy.shots.length, legacy.panels.length);
  assert.deepEqual(
    restoredLegacy.scenes.map((s) => s.blocks.map((b) => [b.type, b.content])),
    legacy.scenes.map((s) => s.blocks.map((b) => [b.type, b.content])),
  );
  verifyGraph(restoredLegacy);
  const plan = prepareImport(original, 'Export', p);
  const restored = plan.project;
  verifyGraph(restored);
  assert.deepEqual(
    restored.scenes,
    p.scenes,
    'Full restore preserves scenes and semantic block IDs exactly',
  );
  assert.deepEqual(
    restored.shots[0].coveredScriptBlockIds,
    p.shots[0].coveredScriptBlockIds,
  );
  assert.equal(restored.panels[0].customPrompt, p.panels[0].customPrompt);
  assert.equal(restored.panels[0].image, p.panels[0].image);
  assert.ok(!JSON.stringify(restored).includes(p.id));
  assert.equal(plan.fileCopies.length, 1);
  const restoredSeries = prepareImport(
    JSON.stringify(series),
    'Export',
    p,
  ).project;
  verifyGraph(restoredSeries.episodes[0]);
  assert.deepEqual(restoredSeries.episodes[0].scenes, p.scenes);
  assert.throws(
    () =>
      prepareImport(JSON.stringify({ ...p, schemaVersion: 99 }), 'Export', p),
    /Unsupported/,
  );
  console.log(
    'PASS: legacy backup reconstruction and current full-snapshot restoration verified separately; complete graph, block IDs, panel edits, nested episodes and attachment copy plans preserved.',
  );
} finally {
  fs.unlinkSync(compiled);
}
