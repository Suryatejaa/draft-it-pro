import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { saveProjects, seeds, openStore } from '../lib/project.ts';
const generated = [];
function compile(file, replacements = []) {
  const target = new URL('../lib/.' + file + '-check.mjs', import.meta.url);
  let source = fs
    .readFileSync(new URL('../lib/' + file + '.ts', import.meta.url), 'utf8')
    .replace("from './project'", "from './project.ts'");
  for (const [from, to] of replacements) source = source.replace(from, to);
  fs.writeFileSync(
    target,
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText,
  );
  generated.push(target);
  return import(target.href);
}
try {
  const store = await compile('workspace-store');
  const cloud = await compile('cloud-sync', [
    [
      "import { firebaseClient } from './firebase';",
      "function firebaseClient(){throw Error('Live Firebase is not configured in this test')} ",
    ],
  ]);
  const backups = await compile('backups');
  const projects = seeds();
  await saveProjects(projects);
  const first = await store.claimGuest('account-a');
  assert.equal(first.length, 1);
  const checkpoint = await store.readWorkspace('account-a');
  assert.equal(
    checkpoint.projects.length,
    1,
    'migration persists projects atomically with the claim',
  );
  assert.equal((await store.claimGuest('account-b')).length, 0);
  assert.equal(await store.readWorkspace('account-b'), undefined);
  assert.equal(
    (await store.claimGuest('account-a')).length,
    0,
    'claim is idempotent',
  );
  const base = { revision: 3, hash: 'abc' };
  await store.saveWorkspace('account-a', {
    projects,
    bases: { [projects[0].id]: base },
  });
  await store.saveWorkspace('account-b', { projects: [], bases: {} });
  assert.equal((await store.readWorkspace('account-a')).projects.length, 1);
  assert.deepEqual(
    (await store.readWorkspace('account-a')).bases[projects[0].id],
    base,
  );
  assert.equal((await store.readWorkspace('account-b')).projects.length, 0);
  await backups.writeBackup(projects[0], 100, 'account-a');
  assert.equal(
    (await backups.readBackups(projects[0].id, 'account-a')).length,
    1,
  );
  assert.equal(
    (await backups.readBackups(projects[0].id, 'account-b')).length,
    0,
  );
  const db = await openStore();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite');
    tx.objectStore('workspace').put(
      [{ savedAt: 50, project: projects[0] }],
      'backups:' + projects[0].id,
    );
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
  db.close();
  assert.equal((await backups.readBackups(projects[0].id)).length, 1);
  await backups.writeBackup(projects[0], 101);
  assert.equal(
    (await backups.readBackups(projects[0].id)).length,
    2,
    'old local backups migrate',
  );
  assert.equal(cloud.mergeGuest(projects, [projects[0]]).length, 1);
  const copy = cloud.conflictCopy(projects[0]);
  assert.notEqual(copy.id, projects[0].id);
  copy.scenes[0].summary = 'Edited copy';
  assert.notEqual(copy.scenes[0].summary, projects[0].scenes[0].summary);
  assert.equal(copy.panels[0].sceneId, copy.scenes[0].id);
  const hash = await cloud.digest(JSON.stringify(projects[0]));
  assert.equal(hash.length, 64);
  assert.equal(
    hash,
    await cloud.digest(JSON.stringify(structuredClone(projects[0]))),
  );
  cloud.validateCloudProject(projects[0], projects[0].id);
  assert.throws(() => cloud.validateCloudProject(projects[0], 'other-id'));
  assert.throws(() =>
    cloud.validateCloudProject(
      { ...projects[0], scenes: [{}] },
      projects[0].id,
    ),
  );
  console.log(
    'Passed: atomic guest migration, account isolation, persisted sync baselines, scoped backups, legacy backup migration, conflict-copy isolation, content hashes, cloud validation. No live Firebase requests made.',
  );
} finally {
  generated.forEach((path) => fs.unlinkSync(path));
}
