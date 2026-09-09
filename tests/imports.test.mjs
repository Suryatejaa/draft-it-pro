import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { seeds, createSeries, updateWorkspace } from '../lib/project.ts';
const compiled = new URL('../lib/.imports-test.mjs', import.meta.url);
const source = fs
  .readFileSync(new URL('../lib/imports.ts', import.meta.url), 'utf8')
  .replace("from './project'", "from './project.ts'");
fs.writeFileSync(
  compiled,
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText,
);
try {
  const { importTabs, importTemplate, prepareImport } = await import(
    compiled.href
  );
  const [p] = seeds();
  const original = JSON.stringify(p);
  for (const tab of importTabs) {
    const template = importTemplate(tab, p);
    const result = prepareImport(JSON.stringify(template), tab, p);
    assert.ok(result.items.length, tab);
    assert.equal(result.newProject, tab === 'Export');
  }
  assert.equal(
    JSON.stringify(p),
    original,
    'Previews must not mutate the project',
  );
  const screenplay = importTemplate('Screenplay', p);
  const result = prepareImport(
    JSON.stringify(screenplay),
    'Screenplay',
    p,
  ).project;
  assert.equal(result.scenes.length, 12);
  assert.deepEqual(result.panels, p.panels);
  assert.equal(result.scenes[11].blocks[3].type, 'parenthetical');
  assert.equal(result.scenes[11].blocks[4].content, 'Can we talk?');
  assert.ok(result.scenes[11].characterIds.length);
  assert.throws(
    () => prepareImport('```json\n{}\n```', 'Screenplay', p),
    /Invalid JSON/,
  );
  assert.throws(
    () => prepareImport(JSON.stringify(screenplay), 'Story', p),
    /not Story/,
  );
  const invalid = structuredClone(screenplay);
  invalid.scenes[0].blocks[0].type = 'poem';
  assert.throws(
    () => prepareImport(JSON.stringify(invalid), 'Screenplay', p),
    /type must be/,
  );
  invalid.scenes[0].blocks[0].type = 'action';
  invalid.scenes.push(structuredClone(invalid.scenes[0]));
  assert.throws(
    () => prepareImport(JSON.stringify(invalid), 'Screenplay', p),
    /Duplicate scene ref/,
  );
  const badPanel = importTemplate('Storyboard', p);
  badPanel.panels[0].sceneId = 'unknown';
  assert.throws(
    () => prepareImport(JSON.stringify(badPanel), 'Storyboard', p),
    /outside this workspace/,
  );
  const badDuration = importTemplate('Shot list', p);
  badDuration.panels[0].duration = -1;
  assert.throws(
    () => prepareImport(JSON.stringify(badDuration), 'Shot list', p),
    /non-negative/,
  );
  const character = {
    schema: 'draft-it-import',
    version: 1,
    type: 'characters',
    characters: [{ name: p.characters[0].name, notes: 'New notes' }],
  };
  const merged = prepareImport(
    JSON.stringify(character),
    'Characters',
    p,
  ).project;
  assert.equal(merged.characters[0].id, p.characters[0].id);
  assert.equal(merged.characters[0].description, p.characters[0].description);
  assert.equal(merged.characters[0].notes, 'New notes');
  p.acts.push('Unwritten epilogue');
  const restored = prepareImport(JSON.stringify(p), 'Export', p).project;
  assert.notEqual(restored.id, p.id);
  assert.deepEqual(restored.acts, p.acts);
  assert.equal(restored.panels[0].sceneId, restored.scenes[0].id);
  assert.deepEqual(
    restored.scenes.map((s) => s.blocks.map((b) => [b.type, b.content])),
    p.scenes.map((s) => s.blocks.map((b) => [b.type, b.content])),
  );
  const series = createSeries('Series', 2);
  series.episodes[0] = {
    ...p,
    id: series.episodes[0].id,
    seasonNumber: 1,
    episodeNumber: 1,
    format: 'Episode',
  };
  const seriesBackup = prepareImport(
    JSON.stringify(series),
    'Export',
    p,
  ).project;
  assert.equal(seriesBackup.episodes.length, 2);
  assert.equal(
    seriesBackup.episodes[0].panels[0].sceneId,
    seriesBackup.episodes[0].scenes[0].id,
  );
  const episode = series.episodes[1];
  const imported = prepareImport(
    JSON.stringify(screenplay),
    'Screenplay',
    episode,
  ).project;
  const updated = updateWorkspace(series, episode.id, () => imported);
  assert.deepEqual(updated.episodes[0], series.episodes[0]);
  assert.equal(updated.episodes[1].scenes.length, 1);
  console.log(
    'All 8 templates, validation errors, preview atomicity, entity merging, backup restoration, and episode isolation passed.',
  );
} finally {
  fs.unlinkSync(compiled);
}
