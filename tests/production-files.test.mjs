import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const file = new URL('../lib/.production-files-check.mjs', import.meta.url);
const objects = new Map([
  [
    'users/u/projects/original/files/f',
    new Blob(['reference bytes'], { type: 'application/pdf' }),
  ],
]);
const writes = [];
globalThis.__productionFileTest = {
  ref: (_storage, path) => path,
  getBlob: async (path) => {
    if (!objects.has(path)) throw Error('missing file');
    return objects.get(path);
  },
  uploadBytes: async (path, blob, metadata) => {
    objects.set(path, blob);
    writes.push({ path, metadata });
  },
};
const source = fs
  .readFileSync(new URL('../lib/production-files.ts', import.meta.url), 'utf8')
  .replace(
    /import\s*\{[^}]+\}\s*from 'firebase\/storage';/,
    'const { ref, uploadBytes, getBlob } = globalThis.__productionFileTest;',
  )
  .replace(
    "import { firebaseClient } from './firebase';",
    'const firebaseClient = () => ({ storage: {} });',
  );
fs.writeFileSync(
  file,
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText,
);
try {
  const { copyProductionFiles } = await import(file.href);
  const copies = [
    {
      sourcePath: 'users/u/projects/original/files/f',
      targetPath: 'users/u/projects/copy/files/f',
      mimeType: 'application/pdf',
    },
  ];
  await copyProductionFiles('u', copies);
  assert.equal(
    await objects.get(copies[0].targetPath).text(),
    'reference bytes',
  );
  assert.equal(
    await objects.get(copies[0].sourcePath).text(),
    'reference bytes',
  );
  assert.equal(writes[0].metadata.contentType, 'application/pdf');
  await assert.rejects(
    () => copyProductionFiles('other-user', copies),
    /original account/,
  );
  await assert.rejects(
    () =>
      copyProductionFiles('u', [
        { ...copies[0], sourcePath: 'users/u/projects/original/files/missing' },
      ]),
    /missing file/,
  );
  assert.equal(
    writes.length,
    1,
    'Failed copies cannot publish destination metadata',
  );
  console.log(
    'PASS: mocked Storage attachment copy preserves bytes/MIME, keeps source intact, rejects other accounts and propagates missing-file failure. No live Firebase calls.',
  );
} finally {
  fs.unlinkSync(file);
  delete globalThis.__productionFileTest;
}
