// Tests: Read-only tools — only read tools registered, searchProject is deterministic
import { test, describe } from 'node:test';
import { strict as strictAssert } from 'node:assert';

import { READ_ONLY_TOOLS, executeToolCall } from '../lib/ai/tools.ts';
import { searchProject } from '../lib/ai/project-search.ts';

const WRITE_TOOL_PATTERNS = [
  'create', 'update', 'delete', 'write', 'modify', 'set', 'add', 'remove', 'insert', 'replace', 'patch',
];

describe('Read-only tool registry', () => {
  test('all registered tools are read-only (no write tools exist)', () => {
    for (const tool of READ_ONLY_TOOLS) {
      const nameLower = tool.name.toLowerCase();
      for (const pattern of WRITE_TOOL_PATTERNS) {
        strictAssert.ok(
          !nameLower.startsWith(pattern),
          `Tool '${tool.name}' appears to be a write operation starting with '${pattern}'`
        );
      }
    }
  });

  test('all registered tools have descriptions', () => {
    for (const tool of READ_ONLY_TOOLS) {
      strictAssert.ok(tool.description && tool.description.length > 5, `Tool '${tool.name}' lacks description`);
    }
  });

  test('expected read-only tools are present', () => {
    const names = READ_ONLY_TOOLS.map((t) => t.name);
    const expected = [
      'getProjectOverview',
      'getEpisodeOverview',
      'getScene',
      'getScenes',
      'getCharacter',
      'getCharacters',
      'getStoryLocation',
      'getStoryLocations',
      'getSceneCards',
      'getShots',
      'getBreakdown',
      'getSchedule',
      'searchProject',
    ];
    for (const name of expected) {
      strictAssert.ok(names.includes(name), `Tool '${name}' is expected but missing from registry`);
    }
  });
});

const MINI_PROJECT = {
  id: 'proj-1',
  title: 'Night Drive',
  format: 'Short',
  genre: 'Thriller',
  logline: 'Two strangers in a car',
  premise: '',
  theme: '',
  synopsis: '',
  treatment: '',
  notes: '',
  references: '',
  targetRuntime: 20,
  draft: 'v1',
  updatedAt: '2026-01-01',
  scenes: [
    {
      id: 's1',
      act: 'Act 1',
      heading: 'INT. VEHICLE - NIGHT',
      summary: 'Two strangers meet inside a car.',
      purpose: '',
      storyDay: 1, duration: 2, status: 'active', notes: '',
      locationId: 'loc-1',
      characterIds: ['c1'],
      blocks: [
        { id: 'b1', type: 'action', content: 'Rain hammers the windshield.' },
        { id: 'b2', type: 'character', content: 'MAYA' },
        { id: 'b3', type: 'dialogue', content: 'Where are we going?' },
      ],
    },
  ],
  characters: [
    { id: 'c1', name: 'Maya', role: 'Protagonist', bio: 'A hitchhiker with secrets.' },
  ],
  locations: [
    { id: 'loc-1', name: 'Vehicle', description: 'A moving car on a rainy highway.' },
  ],
  panels: [],
  acts: ['Act 1'],
};

describe('searchProject — deterministic retrieval', () => {
  test('finds scene by heading keyword', () => {
    const results = searchProject(MINI_PROJECT, 'vehicle');
    strictAssert.ok(results.length > 0, 'Should find scene by heading');
    strictAssert.ok(results[0].type === 'scene' || results[0].type === 'location');
  });

  test('finds character by name', () => {
    const results = searchProject(MINI_PROJECT, 'Maya');
    strictAssert.ok(results.some((r) => r.type === 'character' && r.title === 'Maya'));
  });

  test('finds scene by screenplay block text', () => {
    const results = searchProject(MINI_PROJECT, 'windshield');
    strictAssert.ok(results.some((r) => r.type === 'scene'));
  });

  test('returns empty for irrelevant query', () => {
    const results = searchProject(MINI_PROJECT, 'xylophone unicorn quantum cheese');
    strictAssert.equal(results.length, 0);
  });

  test('returns consistently ordered results by relevance score', () => {
    const r1 = searchProject(MINI_PROJECT, 'maya');
    const r2 = searchProject(MINI_PROJECT, 'maya');
    strictAssert.deepEqual(
      r1.map((r) => r.id),
      r2.map((r) => r.id),
      'searchProject should be deterministic'
    );
  });
});

describe('executeToolCall — read-only project tool execution', () => {
  test('getProjectOverview returns project metadata without API keys', () => {
    const result = executeToolCall('getProjectOverview', {}, MINI_PROJECT, undefined);
    strictAssert.ok(result.title === 'Night Drive');
    strictAssert.ok(!('apiKey' in result), 'API keys must not appear in tool result');
  });

  test('getCharacter strips private contact fields', () => {
    const projectWithPrivate = {
      ...MINI_PROJECT,
      characters: [
        { id: 'c1', name: 'Maya', role: 'Protagonist', bio: 'A hitchhiker.', phone: '+91-0000', email: 'x@x.com', address: '99 Hidden St' },
      ],
    };
    const result = executeToolCall('getCharacter', { characterIdOrName: 'Maya' }, projectWithPrivate, undefined);
    strictAssert.ok(!('phone' in result), 'Phone must be stripped');
    strictAssert.ok(!('email' in result), 'Email must be stripped');
    strictAssert.ok(!('address' in result), 'Address must be stripped');
    strictAssert.equal(result.name, 'Maya');
  });

  test('getScene returns undefined for unknown scene', () => {
    const result = executeToolCall('getScene', { sceneId: 'nonexistent' }, MINI_PROJECT, undefined);
    strictAssert.ok(result.error, 'Should return error object for unknown scene ID');
  });

  test('undefined tool name returns error, does not throw', () => {
    const result = executeToolCall('createScene', {}, MINI_PROJECT, undefined);
    strictAssert.ok(result.error, 'Unrecognised tool should return error, not mutate project');
  });
});
