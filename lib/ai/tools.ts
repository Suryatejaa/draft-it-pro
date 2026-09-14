import { compactScene, traceScenePayload } from './scene-payload.ts';
import { getEpisodeSceneScope, sceneRetrievalCoverage } from './episode-scenes.ts';
import type { Project, Scene, Person, Place } from '../project.ts';
import type { ToolDefinition } from './types.ts';
import { searchProject } from './project-search.ts';


export const READ_ONLY_TOOLS: ToolDefinition[] = [
  {
    name: 'getProjectOverview',
    description: 'Get high-level project metadata (title, format, genre, logline, premise, theme, synopsis, rules).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getEpisodeOverview',
    description: 'Get overview of the active episode when working inside a series project.',
    parameters: {
      type: 'object',
      properties: {
        episodeId: { type: 'string', description: 'Optional episode ID. Defaults to current active episode.' },
      },
    },
  },
  {
    name: 'getScene',
    description: 'Get details and screenplay text of a specific scene by scene ID or scene heading/number.',
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'Unique scene ID or scene heading' },
      },
      required: ['sceneId'],
    },
  },
  {
    name: 'getScenes',
    description: 'Get all scene summaries or a range of scenes in the project/episode.',
    parameters: {
      type: 'object',
      properties: {
        act: { type: 'string', description: 'Filter scenes by act name (e.g. Act 1)' },
        limit: { type: 'number', description: 'Max number of scenes to return; omit for a complete list' },
        characterId: { type: 'string', description: 'Filter by an exact character ID from getCharacter/getCharacters' },
      },
    },
  },
  {
    name: 'getCharacter',
    description: 'Get details, description, arc, and scene appearances of a specific character by name or ID.',
    parameters: {
      type: 'object',
      properties: {
        characterIdOrName: { type: 'string', description: 'Character ID or name' },
      },
      required: ['characterIdOrName'],
    },
  },
  {
    name: 'getCharacters',
    description: 'Get a list of main characters in the project/episode.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getStoryLocation',
    description: 'Get story location details by name or ID.',
    parameters: {
      type: 'object',
      properties: {
        locationIdOrName: { type: 'string', description: 'Location ID or name' },
      },
      required: ['locationIdOrName'],
    },
  },
  {
    name: 'getStoryLocations',
    description: 'Get all story locations in the project.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getSceneCards',
    description: 'Get scene cards for beat planning and structural overview.',
    parameters: {
      type: 'object',
      properties: {
        act: { type: 'string', description: 'Filter by act' },
      },
    },
  },
  {
    name: 'getShots',
    description: 'Get shot designer and storyboard panel list for scenes.',
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'Filter by scene ID' },
      },
    },
  },
  {
    name: 'getBreakdown',
    description: 'Get production breakdown elements (cast, story location, props/assets required per scene). Excludes sensitive cast contact info.',
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'Optional scene ID' },
      },
    },
  },
  {
    name: 'getSchedule',
    description: 'Get shooting schedule and stripboard days. Excludes private contact info.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'searchProject',
    description: 'Search the project for scenes, characters, locations, screenplay text, or rules using keywords.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or keywords' },
      },
      required: ['query'],
    },
  },
];

function readToolCall(
  toolName: string,
  args: Record<string, any>,
  rootProject: Project,
  activeWorkspace?: Project
): any {
  const currentProj = getEpisodeSceneScope(rootProject, activeWorkspace).project;

  switch (toolName) {
    case 'getProjectOverview':
      return {
        title: rootProject.title,
        format: rootProject.format,
        genre: rootProject.genre,
        logline: rootProject.logline,
        premise: rootProject.premise,
        theme: rootProject.theme,
        synopsis: rootProject.synopsis,
        treatment: rootProject.treatment,
        notes: rootProject.notes,
        totalScenes: (currentProj.scenes || []).length,
        totalCharacters: (currentProj.characters || []).length,
      };

    case 'getEpisodeOverview':
      if (currentProj.kind === 'series' || rootProject.episodes) {
        const ep = args.episodeId
          ? rootProject.episodes?.find((e) => e.id === args.episodeId)
          : currentProj;
        if (!ep) return { error: 'Episode not found.' };
        return {
          id: ep.id,
          title: ep.title,
          seasonNumber: ep.seasonNumber || 1,
          episodeNumber: ep.episodeNumber || 1,
          logline: ep.logline,
          synopsis: ep.synopsis,
          sceneCount: (ep.scenes || []).length,
        };
      }
      return { info: 'Project is a single feature/short screenplay, not a series episode.' };

    case 'getScene': {
      const q = String(args.sceneId).toLowerCase();
      const scene = /^\d+$/.test(q) ? currentProj.scenes[Number(q) - 1] : (currentProj.scenes || []).find(
        (s) => s.id === args.sceneId || (s.heading && s.heading.toLowerCase().includes(q))
      );
      if (!scene) return { error: `Scene '${args.sceneId}' not found.` };
      return {
        id: scene.id,
        heading: scene.heading,
        act: scene.act,
        summary: scene.summary,
        purpose: scene.purpose,
        blocks: scene.blocks,
        characterIds: scene.characterIds,
        locationId: scene.locationId,
      };
    }

    case 'getScenes': {
      let scenes = currentProj.scenes || [];
      traceScenePayload('getScenes.inputScope', scenes.map(scene => scene.id), { workspaceId: currentProj.id, inputSceneCount: scenes.length });
      if (args.act) {
        const actName = String(args.act).toLowerCase();
        scenes = scenes.filter((s) => s.act && s.act.toLowerCase() === actName);
      }
      if (args.characterId) scenes = scenes.filter(s => (s.characterIds || []).includes(args.characterId));
      if (args.limit && typeof args.limit === 'number') {
        scenes = scenes.slice(0, args.limit);
      }
      const representations = scenes.map(scene => compactScene(scene, currentProj.scenes.findIndex(candidate => candidate.id === scene.id) + 1, currentProj));
      traceScenePayload('getScenes.resultCount', representations.map(scene => scene.id), { inputScope: currentProj.id });
      return representations;
    }

    case 'getCharacter': {
      const q = String(args.characterIdOrName).toLowerCase();
      const char = (currentProj.characters || []).find(
        (c) => c.id === args.characterIdOrName || (c.name && c.name.toLowerCase() === q)
      );
      if (!char) return { error: `Character '${args.characterIdOrName}' not found.` };
      
      // Exclude private contact fields if any
      return { id: char.id, name: char.name, role: char.role, description: char.description, arc: char.arc, goals: char.goals, fear: char.fear, backstory: char.backstory, sceneIds: currentProj.scenes.filter(s => s.characterIds.includes(char.id)).map(s=>s.id) };
    }

    case 'getCharacters': {
      return (currentProj.characters || []).map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        description: c.description || '',
        arc: c.arc || '',
        goals: c.goals || '',
        fear: c.fear || '',
        backstory: c.backstory || '',
      }));
    }

    case 'getStoryLocation': {
      const q = String(args.locationIdOrName).toLowerCase();
      const loc = (currentProj.locations || []).find(
        (l) => l.id === args.locationIdOrName || (l.name && l.name.toLowerCase() === q)
      );
      if (!loc) return { error: `Location '${args.locationIdOrName}' not found.` };
      return { id: loc.id, name: loc.name, description: loc.description, visualDescription: loc.visualDescription, storyRequirements: loc.storyRequirements, sceneIds: currentProj.scenes.filter(s=>s.locationId===loc.id).map(s=>s.id) };
    }

    case 'getStoryLocations':
      return (currentProj.locations || []).map((l) => ({ id: l.id, name: l.name }));

    case 'getSceneCards': {
      return (currentProj.scenes || []).filter(s => !args.act || s.act?.toLowerCase() === String(args.act).toLowerCase()).map((s) => ({
        id: s.id,
        act: s.act,
        heading: s.heading,
        summary: s.summary,
        purpose: s.purpose,
        emotion: s.emotion,
      }));
    }

    case 'getShots': {
      let panels = currentProj.panels || [];
      if (args.sceneId) {
        panels = panels.filter((p) => p.sceneId === args.sceneId);
      }
      return panels.map((p) => ({
        id: p.id,
        sceneId: p.sceneId,
        status: p.status,
        prompt: p.generatedPrompt || p.customPrompt || '',
        shotIntent: p.shotIntent,
      }));
    }

    case 'getBreakdown': {
      const scenes = (currentProj.scenes || []).filter(s => !args.sceneId || s.id === args.sceneId);
      return scenes.map((s) => ({
        sceneId: s.id,
        heading: s.heading,
        characters: (currentProj.characters || [])
          .filter((c) => (s.characterIds || []).includes(c.id))
          .map((c) => c.name),
        location: (currentProj.locations || []).find((l) => l.id === s.locationId)?.name || 'Unassigned',
      }));
    }

    case 'getSchedule': {
      return {
        totalScenes: (currentProj.scenes || []).length,
        shootDaysCount: (currentProj as any).shootDays?.length || 0,
        summary: 'Counts only. Shoot-day details and production order are not included in this tool result.',
      };
    }

    case 'searchProject':
      return searchProject(currentProj, String(args.query || ''));

    default:
      return { error: `Tool '${toolName}' is not defined.` };
  }
}

export function executeToolCall(toolName: string, args: Record<string, unknown>, rootProject: Project, activeWorkspace?: Project): unknown {
  // No returned object can be used to mutate the workspace by reference.
  return structuredClone(readToolCall(toolName, args, rootProject, activeWorkspace));
}


/** Envelopes describe exactly what was retrieved, never imply screenplay completeness from summaries. */
export function retrieveToolResult(name: string, args: Record<string, unknown>, root: Project, workspace?: Project) {
  const episodeScope = getEpisodeSceneScope(root, workspace);
  const project = episodeScope.project;
  const definition = READ_ONLY_TOOLS.find(tool => tool.name === name);
  if (!definition) return { error: 'Unknown read-only tool.', complete: false };
  for (const required of definition.parameters.required || []) {
    if (typeof args[required] !== 'string' || !String(args[required]).trim()) return { error: `Missing ${required}`, complete: false };
  }
  for (const [key, value] of Object.entries(args)) {
    const expected = definition.parameters.properties[key]?.type;
    if (!expected || typeof value !== expected) return { error: 'Invalid tool arguments.', complete: false };
  }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1)) return { error: 'limit must be a positive integer.', complete: false };
  const data = executeToolCall(name, args, root, workspace);
  let totalMatching: number | undefined;
  if (name === 'getScenes') totalMatching = project.scenes.filter(s => (!args.act || s.act?.toLowerCase() === String(args.act).toLowerCase()) && (!args.characterId || (s.characterIds || []).includes(String(args.characterId)))).length;
  const returnedCount = Array.isArray(data) ? data.length : undefined;
  const fullList = ['getScenes', 'getSceneCards', 'getCharacters', 'getStoryLocations'].includes(name);
  const hasError = !!(data && typeof data === 'object' && 'error' in data);
  const scenes = episodeScope.scenes;
  const matchedCharacter = name === 'getCharacter'
    ? project.characters?.find(c => c.id === args.characterIdOrName || c.name.toLowerCase() === String(args.characterIdOrName).toLowerCase())
    : project.characters?.find(c => c.id === args.characterId);
  const matched = scenes.filter(scene =>
    (!args.act || scene.act?.toLowerCase() === String(args.act).toLowerCase()) &&
    (!(args.characterId || name === 'getCharacter') || (scene.characterIds || []).includes(matchedCharacter?.id || String(args.characterId)))
  );
  const sceneList = name === 'getScenes' || name === 'getSceneCards';
  const returnedIds = new Set(sceneList && Array.isArray(data) ? data.map(item => item.id) : name === 'getCharacter' && data && typeof data === 'object' && 'sceneIds' in data ? data.sceneIds as string[] : []);
  const returned = scenes.filter(scene => returnedIds.has(scene.id));
  const coverage = sceneRetrievalCoverage(episodeScope, scenes, matched, returned);
  const complete = !hasError && !args.act && (sceneList || name === 'getCharacter'
    ? coverage.complete : fullList && episodeScope.complete);

  return {
    scope: { projectId: root.id, workspaceId: name === 'getEpisodeOverview' && typeof args.episodeId === 'string' ? args.episodeId : project.id },
    complete,
    episodeCoverage: { ...coverage, scope: episodeScope.episodeId ? 'episode' : 'project', episodeId: episodeScope.episodeId, matchedCharacter: matchedCharacter?.name, complete },
    completenessMeaning: 'Complete requires the full canonical episode scene set to be available and every matching scene to be returned. Character filtering may reduce matches, not scenes scanned. Summaries are not full screenplay text. Act-filtered results are not episode-complete.',
    detail: name === 'getScene' ? 'single_scene_screenplay' : name === 'getScenes' || name === 'getSceneCards' ? 'scene_summaries_only' : name === 'getCharacter' ? 'character_fields_and_all_linked_scene_ids' : 'tool_specific_fields_only',
    filters: args, totalMatching, returnedCount, data,
  };
}

/** Explicit broad requests get summaries through the same read-only registry, not snapshot serialization. */
export function initialReadOnlyQueries(query: string, root: Project, workspace?: Project) {
  const project = getEpisodeSceneScope(root, workspace).project;
  const broad = /\b(every|all)\s+(?:the\s+)?(scenes?|locations?)\b|\b(across|throughout)\b|\b(entire|whole)\s+(episode|project)\b|\barc\b/i.test(query);
  const appearance = /\bappear(?:s|ances)?\b|\bscenes?\s+(?:involving|with)\b/i.test(query);
  const character = (project.characters || []).find(c => c.name && (' ' + query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).join(' ') + ' ').includes(' ' + c.name.toLocaleLowerCase() + ' '));
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  if ((broad || appearance) && character) calls.push({ name: 'getCharacter', arguments: { characterIdOrName: character.id } });
  if (broad && /\blocations?\b/i.test(query)) calls.push({ name: 'getStoryLocations', arguments: {} });
  // Do not pre-filter by character links: the model needs every scene represented to assess an exhaustive question.
  if (broad || appearance) calls.push({ name: 'getScenes', arguments: {} });
  return calls;
}
