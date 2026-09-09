import assert from 'node:assert/strict';
import { seeds, reconcile, moveScene, locationName } from '../lib/project.ts';
const [p] = seeds();
assert.equal(p.scenes.length, 11);
assert.equal(p.characters.length, 2);
assert.equal(
  p.scenes.reduce((n, s) => n + s.duration, 0),
  60,
);
const original = p.scenes[0];
const moved = moveScene(p, original.id, 'Act III');
assert.equal(moved.scenes.at(-1).id, original.id);
assert.equal(moved.scenes.at(-1).act, 'Act III');
assert.ok(moved.panels.some((panel) => panel.sceneId === original.id));
assert.equal(new Set(moved.scenes.map((s) => s.id)).size, 11);
const edited = reconcile({
  ...p,
  scenes: p.scenes.map((s, i) =>
    i
      ? s
      : {
          ...s,
          blocks: s.blocks.map((b) =>
            b.type === 'scene_heading'
              ? { ...b, content: 'EXT. STATION - DAY' }
              : b.type === 'character'
                ? { ...b, content: 'STRANGER' }
                : b,
          ),
        },
  ),
});
assert.equal(
  edited.locations.find((l) => l.id === edited.scenes[0].locationId).name,
  'STATION',
);
assert.equal(
  edited.characters.find((c) => c.id === edited.scenes[0].characterIds[0]).name,
  'STRANGER',
);
const again = reconcile({
  ...edited,
  scenes: edited.scenes.map((s, i) =>
    i
      ? s
      : {
          ...s,
          blocks: s.blocks.map((b) =>
            b.type === 'character' ? { ...b, content: 'VISITOR' } : b,
          ),
        },
  ),
});
assert.ok(!again.characters.some((c) => c.name === 'STRANGER'));
assert.equal(locationName('INT./EXT. TRAIN - CONTINUOUS'), 'TRAIN');
assert.deepEqual(moveScene(p, 'missing', 'Act I'), p);
console.log(
  'Scene order, stable shot links, heading recognition, character linking, and entity cleanup passed.',
);

const {
  createSeries,
  createEpisode,
  normalizeProject,
  updateWorkspace,
  blankProject,
  newScene,
} = await import('../lib/project.ts');
const series = createSeries('Two lives', 2);
assert.equal(series.kind, 'series');
assert.equal(series.episodes.length, 2);
const episodeOne = series.episodes[0],
  episodeTwo = series.episodes[1];
const changed = updateWorkspace(series, episodeOne.id, (e) =>
  reconcile({ ...e, scenes: [newScene()] }),
);
assert.equal(changed.episodes[0].scenes.length, 1);
assert.equal(changed.episodes[1].scenes.length, 0);
assert.deepEqual(changed.episodes[1], episodeTwo);
assert.equal(changed.scenes.length, 0);
const seasonTwo = createEpisode('A new beginning', 2, 1);
assert.equal(seasonTwo.seasonNumber, 2);
assert.equal(seasonTwo.episodeNumber, 1);
const legacy = { ...p, kind: undefined, format: 'Series' };
const migrated = normalizeProject(legacy);
assert.equal(migrated.episodes[0].scenes[0].id, p.scenes[0].id);
assert.deepEqual(migrated.episodes[0].panels, p.panels);
assert.deepEqual(normalizeProject(migrated), migrated);
assert.equal(
  normalizeProject(blankProject('A film', 'Short Film')).kind,
  'single',
);
assert.throws(() => createSeries('Bad', 0));
assert.throws(() => createSeries('Bad', 2.5));
assert.deepEqual(
  JSON.parse(JSON.stringify(changed)).episodes,
  changed.episodes,
);
console.log(
  'Series creation, episode isolation, seasons, legacy migration, and backup serialization passed.',
);
