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
  // Test multiline transition splitting and space trimming
  const multilineScript = structuredClone(screenplay);
  multilineScript.scenes = [{
    ref: 'scene-test-split',
    heading: 'INT. TEST - DAY',
    blocks: [
      {
        type: 'transition',
        content: 'MONTAGE:\nRTC BUS HYDERABAD CITY LO ENTER AVUTHUNDI.:\nBUS WINDOW DAGGARA SIRISHA...'
      },
      {
        type: 'character',
        content: '   SIRISHA (V.O.)  '
      },
      {
        type: 'dialogue',
        content: '    Na peru Sirisha.'
      }
    ]
  }];
  const splitResult = prepareImport(
    JSON.stringify(multilineScript),
    'Screenplay',
    p
  ).project;
  const lastScene = splitResult.scenes.at(-1);
  // blocks: [scene_heading, transition(MONTAGE:), action(RTC BUS...), action(BUS WINDOW...), character(SIRISHA (V.O.)), dialogue(Na peru Sirisha.)]
  assert.equal(lastScene.blocks[1].type, 'transition');
  assert.equal(lastScene.blocks[1].content, 'MONTAGE:');
  assert.equal(lastScene.blocks[2].type, 'action');
  assert.equal(lastScene.blocks[2].content, 'RTC BUS HYDERABAD CITY LO ENTER AVUTHUNDI.:');
  assert.equal(lastScene.blocks[3].type, 'action');
  assert.equal(lastScene.blocks[3].content, 'BUS WINDOW DAGGARA SIRISHA...');
  assert.equal(lastScene.blocks[4].type, 'character');
  assert.equal(lastScene.blocks[4].content, 'SIRISHA (V.O.)');
  assert.equal(lastScene.blocks[5].type, 'dialogue');
  assert.equal(lastScene.blocks[5].content, 'Na peru Sirisha.');

  console.log(
    'All 8 templates, validation errors, preview atomicity, entity merging, backup restoration, transition splitting, and episode isolation passed.',
  );
} finally {
  fs.unlinkSync(compiled);
}
