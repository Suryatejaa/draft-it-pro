import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Transpile helper: read TS source, fix bare './project' specifiers, emit ESM JS.
function transpileLib(fileName) {
  const src = fs
    .readFileSync(new URL(`../lib/${fileName}`, import.meta.url), 'utf8')
    .replace(/from\s+'\.\/project'/g, "from './project.ts'");
  return ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
}

const plannerOut = new URL('../lib/.storyboard-planner-test.mjs', import.meta.url);
const compilerOut = new URL('../lib/.prompt-compiler-test.mjs', import.meta.url);

// Storyboard planner also imports from prompt-compiler indirectly, but both only
// depend on project.ts types (stripped) + uid (runtime). Write both compiled files.
fs.writeFileSync(plannerOut, transpileLib('storyboard-planner.ts'));
fs.writeFileSync(compilerOut, transpileLib('prompt-compiler.ts'));

try {
  const { planSceneStoryboard } = await import(plannerOut.href);
  const { buildStoryboardPrompt, computeSceneContentHash } = await import(compilerOut.href);

  // --- Fixture: realistic scene with two speakers and a prop ---
  const scene = {
    id: 'scene-interview',
    act: 'Act I',
    heading: 'INT. INTERVIEW ROOM - DAY',
    locationId: 'loc-interview',
    characterIds: ['char-sirisha', 'char-interviewer'],
    duration: 2,
    summary: 'Job interview scene',
    blocks: [
      { id: 'b1', type: 'scene_heading', content: 'INT. INTERVIEW ROOM - DAY' },
      { id: 'b2', type: 'action', content: 'A sparse room with a rectangular wooden table at the center.' },
      { id: 'b3', type: 'character', content: 'SIRISHA' },
      { id: 'b4', type: 'dialogue', content: 'Good morning, thank you for having me.' },
      { id: 'b5', type: 'action', content: 'She reaches into her briefcase and pulls out a printed resume, sliding it across the table.' },
      { id: 'b6', type: 'character', content: 'INTERVIEWER' },
      { id: 'b7', type: 'parenthetical', content: 'glancing up skeptically' },
      { id: 'b8', type: 'dialogue', content: 'Your portfolio shows promise, but your timeline has gaps.' },
      { id: 'b9', type: 'action', content: 'Sirisha stares at the interviewer with quiet determination.' },
    ],
  };

  const characters = [
    {
      id: 'char-sirisha',
      name: 'SIRISHA',
      role: 'protagonist',
      visualDescription:
        'Young Indian woman, late 20s, sharp formal interview blazer, hair tied in a neat bun, intense focused eyes',
    },
    {
      id: 'char-interviewer',
      name: 'INTERVIEWER',
      role: 'supporting',
      visualDescription:
        'Middle-aged man in grey business suit with thick-rimmed glasses and stern posture',
    },
  ];

  const locations = [
    {
      id: 'loc-interview',
      name: 'INTERVIEW ROOM',
      visualDescription:
        'Minimalist corporate interrogation-style interview room, plain white walls, fluorescent ceiling light',
    },
  ];

  // ---- 1. planSceneStoryboard ----
  const plan = planSceneStoryboard(scene, 0, characters, locations);

  assert.ok(plan.suggestedPanels.length >= 3, `Expected ≥3 planned shots, got ${plan.suggestedPanels.length}`);

  // First shot: establishing
  const first = plan.suggestedPanels[0];
  assert.equal(first.purpose, 'establish');
  assert.equal(first.shotSize, 'wide');
  assert.ok(first.description.includes('INT. INTERVIEW ROOM'), 'Establishing shot should reference scene heading');

  // At least one prop-insert shot (resume appears in scene)
  const insertShot = plan.suggestedPanels.find((s) => s.purpose === 'insert');
  assert.ok(insertShot, 'Expected an insert shot for detected prop (resume)');
  assert.ok(
    insertShot.description.toLowerCase().includes('resume') ||
      insertShot.description.toLowerCase().includes('briefcase'),
    'Insert shot should mention the prop',
  );

  // At least one dialogue shot
  const dialogueShot = plan.suggestedPanels.find((s) => s.purpose === 'dialogue');
  assert.ok(dialogueShot, 'Expected at least one dialogue shot');

  // Speaking characters detected
  assert.ok(plan.speakingCharacters.includes('SIRISHA'), 'SIRISHA should be in speakingCharacters');
  assert.ok(plan.speakingCharacters.includes('INTERVIEWER'), 'INTERVIEWER should be in speakingCharacters');

  // Props detected
  assert.ok(plan.propsFound.includes('resume'), '"resume" should appear in propsFound');

  // Location name
  assert.equal(plan.locationName, 'INTERVIEW ROOM');

  // ---- 2. buildStoryboardPrompt ----
  const prompt = buildStoryboardPrompt(scene, first, characters, locations[0]);

  assert.ok(prompt.length > 80, 'Compiled prompt should be a detailed string');
  assert.ok(prompt.toLowerCase().includes('pencil sketch'), 'Default prompt should include pencil sketch style');
  assert.ok(prompt.toLowerCase().includes('interview room'), 'Prompt should reference the location');
  assert.ok(prompt.includes('Camera:'), 'Prompt should include Camera framing line');
  assert.ok(prompt.includes('Wide'), 'Camera line should include shot size label');

  // Prompt for a dialogue shot featuring a character with visualDescription
  if (dialogueShot) {
    const dialoguePrompt = buildStoryboardPrompt(scene, dialogueShot, characters, locations[0]);
    // Character's visual description or name should appear
    const hasCharDetail =
      dialoguePrompt.includes('SIRISHA') ||
      dialoguePrompt.includes('INTERVIEWER') ||
      dialoguePrompt.includes('Young Indian woman') ||
      dialoguePrompt.includes('grey business suit');
    assert.ok(hasCharDetail, 'Dialogue shot prompt should reference character name or visual profile');
  }

  // ---- 3. computeSceneContentHash ----
  const hash1 = computeSceneContentHash(scene);
  assert.ok(hash1 && hash1.length === 8, 'Content hash should be an 8-char hex string');

  // Identical data → identical hash
  const cloned = { ...scene, blocks: [...scene.blocks] };
  assert.equal(computeSceneContentHash(cloned), hash1, 'Identical scene → identical hash');

  // Modified scene → different hash
  const modified = {
    ...scene,
    blocks: [
      ...scene.blocks,
      { id: 'b10', type: 'action', content: 'Suddenly the door bursts open.' },
    ],
  };
  assert.notEqual(computeSceneContentHash(modified), hash1, 'Changed blocks → different hash');

  console.log(
    'Storyboard planner, prompt compiler, and scene content hashing tests passed.',
  );
} finally {
  try { fs.unlinkSync(plannerOut); } catch {}
  try { fs.unlinkSync(compilerOut); } catch {}
}
