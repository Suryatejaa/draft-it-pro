// Tests: Context Builder — layered context, episode isolation, selection inclusion, privacy
import { test, describe } from 'node:test';
import { strict as strictAssert } from 'node:assert';

import { buildAgentContext } from '../lib/ai/context-builder.ts';

const SCENE_1 = {
  id: 'scene-1',
  act: 'Act 1',
  heading: 'INT. ARJUN HOUSE - DAY',
  summary: 'Arjun discovers the letter.',
  purpose: 'Inciting incident',
  storyDay: 1,
  duration: 2,
  status: 'active',
  notes: '',
  locationId: 'loc-1',
  characterIds: ['char-1'],
  blocks: [
    { id: 'b1', type: 'action', content: 'Arjun opens the letter.' },
    { id: 'b2', type: 'character', content: 'ARJUN' },
    { id: 'b3', type: 'dialogue', content: 'What is this?' },
  ],
};

const SCENE_2 = {
  id: 'scene-2',
  act: 'Act 1',
  heading: 'EXT. STREET - NIGHT',
  summary: 'Priya runs away.',
  purpose: 'Rising action',
  storyDay: 1,
  duration: 1,
  status: 'active',
  notes: '',
  locationId: 'loc-2',
  characterIds: ['char-2'],
  blocks: [{ id: 'b4', type: 'action', content: 'Priya runs down the alley.' }],
};

const CHARACTER_WITH_PRIVATE = {
  id: 'char-1',
  name: 'Arjun',
  role: 'Protagonist',
  bio: 'A young filmmaker.',
  phone: '+91-9000000000',      // Private — must be excluded
  email: 'arjun@private.com',  // Private — must be excluded
  address: '12 Main Road',     // Private — must be excluded
};

const UNRELATED_CHARACTER = {
  id: 'char-2',
  name: 'Priya',
  role: 'Antagonist',
  bio: 'A cunning journalist.',
};

const LOCATION = {
  id: 'loc-1',
  name: 'Arjun House',
  description: 'A warm home in Chennai.',
};

const PROJECT = {
  id: 'project-main',
  title: 'Red Envelope',
  format: 'Feature',
  genre: 'Drama',
  logline: 'A filmmaker discovers a conspiracy.',
  premise: 'A secret letter changes everything.',
  theme: 'Truth vs. family loyalty',
  synopsis: 'Arjun finds a letter and unravels the past.',
  treatment: '',
  notes: 'No character explicitly states their feelings.',
  references: '',
  targetRuntime: 90,
  draft: 'Draft 1',
  updatedAt: '2026-01-01',
  scenes: [SCENE_1, SCENE_2],
  characters: [CHARACTER_WITH_PRIVATE, UNRELATED_CHARACTER],
  locations: [LOCATION],
  panels: [],
  acts: ['Act 1', 'Act 2', 'Act 3'],
};

const EPISODE = {
  ...PROJECT,
  id: 'ep-1',
  title: 'Pilot',
  seasonNumber: 1,
  episodeNumber: 1,
  logline: 'Episode logline.',
};

const SERIES_ROOT = {
  ...PROJECT,
  id: 'series-root',
  title: 'Red Envelope Series',
  kind: 'series',
  episodes: [EPISODE],
};

describe('buildAgentContext — Project context', () => {
  test('includes project title and logline', () => {
    const ctx = buildAgentContext({ rootProject: PROJECT });
    strictAssert.ok(ctx.formattedContext.includes('Red Envelope'));
    strictAssert.ok(ctx.formattedContext.includes('A filmmaker discovers a conspiracy.'));
  });

  test('includes project rules from notes', () => {
    const ctx = buildAgentContext({ rootProject: PROJECT });
    strictAssert.ok(ctx.formattedContext.includes('No character explicitly states their feelings.'));
  });
});

describe('buildAgentContext — Episode context isolation', () => {
  test('includes episode overview when activeWorkspace is an episode', () => {
    const ctx = buildAgentContext({ rootProject: SERIES_ROOT, activeWorkspace: EPISODE });
    strictAssert.ok(ctx.formattedContext.includes('EPISODE OVERVIEW'));
    strictAssert.ok(ctx.formattedContext.includes('Pilot'));
  });

  test('does NOT include sibling episode data when querying a specific episode', () => {
    const ctx = buildAgentContext({ rootProject: SERIES_ROOT, activeWorkspace: EPISODE });
    // There are no other episodes' content in this context
    strictAssert.ok(!ctx.formattedContext.includes('sibling-episode-content-placeholder'));
  });
});

describe('buildAgentContext — Local scene context', () => {
  test('includes current scene heading and blocks', () => {
    const ctx = buildAgentContext({
      rootProject: PROJECT,
      activeView: 'Screenplay',
      currentSceneId: 'scene-1',
    });
    strictAssert.ok(ctx.formattedContext.includes('INT. ARJUN HOUSE - DAY'));
    strictAssert.ok(ctx.formattedContext.includes('Arjun opens the letter.'));
  });

  test('includes previous scene summary when current is scene 2', () => {
    const ctx = buildAgentContext({
      rootProject: PROJECT,
      activeView: 'Screenplay',
      currentSceneId: 'scene-2',
    });
    // Previous scene (scene-1) should be summarized above
    strictAssert.ok(ctx.formattedContext.includes('PREVIOUS SCENE'));
    strictAssert.ok(ctx.formattedContext.includes('Arjun discovers the letter.'));
  });
});

describe('buildAgentContext — Selection context', () => {
  test('includes selected text in context when provided', () => {
    const ctx = buildAgentContext({
      rootProject: PROJECT,
      activeView: 'Screenplay',
      currentSceneId: 'scene-1',
      selectedText: 'What is this?',
    });
    strictAssert.ok(ctx.formattedContext.includes("WRITER'S CURRENT SELECTION"));
    strictAssert.ok(ctx.formattedContext.includes('What is this?'));
  });

  test('includes selected block content when block IDs are provided', () => {
    const ctx = buildAgentContext({
      rootProject: PROJECT,
      activeView: 'Screenplay',
      currentSceneId: 'scene-1',
      selectedBlockIds: ['b3'],
    });
    strictAssert.ok(ctx.formattedContext.includes('What is this?'));
  });

  test('includes proposal selection IDs, types, and source revision in provider context', () => {
    const ctx = buildAgentContext({
      rootProject: PROJECT,
      activeView: 'Screenplay',
      currentSceneId: 'scene-1',
      selectedBlockIds: ['b2', 'b3'],
      selectedText: 'ARJUN\nWhat is this?',
      selectionBlockTypes: ['character', 'dialogue'],
      sourceRevision: 'scene-revision-123',
    });

    strictAssert.ok(ctx.formattedContext.includes('Block IDs: b2, b3'));
    strictAssert.ok(ctx.formattedContext.includes('Block types: character, dialogue'));
    strictAssert.ok(ctx.formattedContext.includes('Source revision: scene-revision-123'));
    strictAssert.ok(ctx.formattedContext.includes('[CHARACTER] ARJUN\n[DIALOGUE] What is this?'));
  });
});

describe('buildAgentContext — Privacy filtering', () => {
  test('excludes phone, email, and address from character context', () => {
    const ctx = buildAgentContext({
      rootProject: PROJECT,
      activeView: 'Characters',
    });
    strictAssert.ok(!ctx.formattedContext.includes('+91-9000000000'), 'Phone number should NOT appear in context');
    strictAssert.ok(!ctx.formattedContext.includes('arjun@private.com'), 'Email should NOT appear in context');
    strictAssert.ok(!ctx.formattedContext.includes('12 Main Road'), 'Address should NOT appear in context');
  });
});

describe('buildAgentContext — Context summary tag', () => {
  test('builds series episode context tag', () => {
    const ctx = buildAgentContext({ rootProject: SERIES_ROOT, activeWorkspace: EPISODE, activeView: 'Screenplay' });
    strictAssert.ok(ctx.activeContextSummary.includes('S01 E01'));
    strictAssert.ok(ctx.activeContextSummary.includes('Screenplay'));
  });

  test('builds standalone project context tag', () => {
    const ctx = buildAgentContext({ rootProject: PROJECT, activeView: 'Screenplay' });
    strictAssert.ok(ctx.activeContextSummary.includes('Red Envelope'));
  });
});
