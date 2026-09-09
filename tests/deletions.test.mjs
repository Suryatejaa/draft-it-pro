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
  console.log(
    'Deletion checks passed: scene/shot cascades, entity suppression, script preservation, empty series, story clearing, and immutable updates.',
  );
} finally {
  fs.unlinkSync(path);
}
