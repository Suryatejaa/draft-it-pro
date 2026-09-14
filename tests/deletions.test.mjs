import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {
  seeds,
  reconcile,
  createSeries,
  normalizeProject,
} from '../lib/project.ts';
const path = new URL('../lib/.deletions-test.mjs', import.meta.url);
fs.writeFileSync(
  path,
  ts.transpileModule(
    fs.readFileSync(new URL('../lib/deletions.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
);
try {
  const { deleteElement } = await import(path.href);
  const [p] = seeds();
  const original = JSON.stringify(p);
  const scene = p.scenes[0];
  const after = deleteElement(p, 'scene', scene.id);
  assert.equal(after.scenes.length, p.scenes.length - 1);
  assert.ok(!after.panels.some((x) => x.sceneId === scene.id));
  assert.deepEqual(after.scenes[0], p.scenes[1]);
  const person = p.characters[0];
  const removed = reconcile(deleteElement(p, 'character', person.id));
  assert.ok(!removed.characters.some((c) => c.name === person.name));
  assert.ok(!removed.scenes.some((s) => s.characterIds.includes(person.id)));
  assert.deepEqual(removed.scenes[0].blocks, p.scenes[0].blocks);
  const place = p.locations[0];
  assert.ok(
    !reconcile(deleteElement(p, 'location', place.id)).locations.some(
      (l) => l.name === place.name,
    ),
  );
  const panel = deleteElement(p, 'panel', p.panels[0].id);
  assert.equal(panel.panels.length, p.panels.length - 1);
  assert.deepEqual(panel.scenes, p.scenes);
  const series = createSeries('Series', 2);
  const remaining = deleteElement(series, 'episode', series.episodes[0].id);
  assert.equal(remaining.episodes[0].id, series.episodes[1].id);
  const empty = normalizeProject(
    deleteElement(remaining, 'episode', remaining.episodes[0].id),
  );
  assert.equal(empty.episodes.length, 0);
  const cleared = deleteElement(p, 'story');
  assert.equal(cleared.logline, '');
  assert.equal(cleared.title, p.title);
  assert.deepEqual(cleared.scenes, p.scenes);
  const act = deleteElement(p, 'act', p.acts[0]);
  assert.ok(!act.scenes.some((s) => s.act === p.acts[0]));
  assert.ok(
    act.panels.every((panel) => act.scenes.some((s) => s.id === panel.sceneId)),
  );
  assert.equal(JSON.stringify(p), original);

  // Test reference-safe production entity deletion
  const { deleteProductionEntity } = await import('../lib/production.ts');

  // 1. Delete Cast Member
  const pCast = {
    ...p,
    castMembers: [{ id: 'cast-1', name: 'Actor 1', assignedCharacterIds: [p.characters[0].id] }],
    characters: p.characters.map((c, i) => (i === 0 ? { ...c, castMemberId: 'cast-1', castingStatus: 'cast' } : c)),
  };
  const afterCastDelete = deleteProductionEntity(pCast, 'castMembers', 'cast-1');
  assert.equal(afterCastDelete.castMembers.length, 0);
  assert.equal(afterCastDelete.characters[0].castMemberId, '');
  assert.equal(afterCastDelete.characters[0].castingStatus, 'uncast');
  assert.equal(afterCastDelete.characters[0].id, p.characters[0].id); // Character preserved

  // 2. Delete Shooting Location
  const pLoc = {
    ...p,
    shootingLocations: [{ id: 'loc-1', name: 'Set 1' }],
    locations: p.locations.map((l, i) => (i === 0 ? { ...l, shootingLocationId: 'loc-1' } : l)),
    shootDays: [{ id: 'day-1', number: 1, shootingLocationIds: ['loc-1'], scheduledSceneIds: [p.scenes[0].id] }],
  };
  const afterLocDelete = deleteProductionEntity(pLoc, 'shootingLocations', 'loc-1');
  assert.equal(afterLocDelete.shootingLocations.length, 0);
  assert.equal(afterLocDelete.locations[0].shootingLocationId, '');
  assert.equal(afterLocDelete.locations[0].id, p.locations[0].id); // Story location preserved
  assert.deepEqual(afterLocDelete.shootDays[0].shootingLocationIds, []); // Removed from shoot day

  // 3. Delete Asset
  const pAsset = {
    ...p,
    assets: [{ id: 'asset-1', name: 'Prop Gun' }],
    breakdownItems: [{ id: 'item-1', name: 'Gun', linkedAssetId: 'asset-1', sceneId: p.scenes[0].id }],
  };
  const afterAssetDelete = deleteProductionEntity(pAsset, 'assets', 'asset-1');
  assert.equal(afterAssetDelete.assets.length, 0);
  assert.equal(afterAssetDelete.breakdownItems[0].linkedAssetId, ''); // Link cleared
  assert.equal(afterAssetDelete.breakdownItems[0].name, 'Gun'); // Breakdown item preserved

  // 4. Delete Shoot Day
  const pDay = {
    ...p,
    shootDays: [{ id: 'day-1', number: 1, scheduledSceneIds: [p.scenes[0].id] }],
    callSheets: [{ id: 'sheet-1', shootDayId: 'day-1' }],
  };
  const afterDayDelete = deleteProductionEntity(pDay, 'shootDays', 'day-1');
  assert.equal(afterDayDelete.shootDays.length, 0);
  assert.equal(afterDayDelete.callSheets.length, 0);
  assert.equal(afterDayDelete.scenes[0].id, p.scenes[0].id); // Scenes preserved intact in screenplay order

  // 5. Delete Character Look
  const pLook = {
    ...p,
    characterLooks: [{ id: 'look-1', name: 'Hero Jacket' }],
    continuityRecords: [{ id: 'cont-1', characterLookId: 'look-1', sceneId: p.scenes[0].id }],
  };
  const afterLookDelete = deleteProductionEntity(pLook, 'characterLooks', 'look-1');
  assert.equal(afterLookDelete.characterLooks.length, 0);
  assert.equal(afterLookDelete.continuityRecords[0].characterLookId, '');

  // 6. Delete Shot preserves panel
  const pShot = {
    ...p,
    shots: [{ id: 'shot-1', shotCode: '1A', sceneId: p.scenes[0].id }],
    panels: [{ id: 'panel-1', shotId: 'shot-1', sceneId: p.scenes[0].id }],
  };
  const afterShotDelete = deleteProductionEntity(pShot, 'shots', 'shot-1');
  assert.equal(afterShotDelete.shots.length, 0);
  assert.equal(afterShotDelete.panels[0].id, 'panel-1');
  assert.equal(afterShotDelete.panels[0].shotId, undefined); // Panel unlinked & preserved

  console.log(
    'Deletion checks passed: scene/shot cascades, entity suppression, script preservation, empty series, story clearing, production entity reference safety, and immutable updates.',
  );
} finally {
  fs.unlinkSync(path);
}
