import { traceScenePayload } from './scene-payload.ts';
import { getEpisodeSceneScope } from './episode-scenes.ts';
import type { Project, Scene, Person, Place, Panel } from '../project';

export interface SearchResultItem {
  id: string;
  type: 'scene' | 'character' | 'location' | 'shot' | 'note' | 'rule';
  title: string;
  snippet: string;
  score: number;
  metadata?: Record<string, any>;
}

export function searchProject(root: Project, query: string, workspace?: Project): SearchResultItem[] {
  const project = getEpisodeSceneScope(root, workspace).project;
  if (!query || query.trim().length === 0) return [];
  const q = query.toLowerCase().trim();
  const keywords = q.split(/\s+/).filter(Boolean);

  const results: SearchResultItem[] = [];

  // Helper score calculator
  const calcScore = (text: string, title = ''): number => {
    if (!text) return 0;
    const lower = text.toLowerCase();
    let score = 0;

    if (title && title.toLowerCase().includes(q)) score += 10;
    if (lower.includes(q)) score += 5;

    for (const kw of keywords) {
      if (title && title.toLowerCase().includes(kw)) score += 3;
      if (lower.includes(kw)) score += 1;
    }
    return score;
  };

  // 1. Scenes & Screenplay blocks
  for (const scene of project.scenes || []) {
    const heading = scene.heading || '';
    const summary = scene.summary || '';
    const purpose = scene.purpose || '';
    const scriptText = (scene.blocks || []).map((b) => b.content).join(' ');

    const combinedText = `${heading} ${summary} ${purpose} ${scriptText}`;
    const score = calcScore(combinedText, heading);

    if (score > 0) {
      results.push({
        id: scene.id,
        type: 'scene',
        title: heading || `Scene ${scene.id}`,
        snippet: summary || scriptText.slice(0, 150) || heading,
        score,
        metadata: {
          act: scene.act,
          characterIds: scene.characterIds,
          locationId: scene.locationId,
        },
      });
    }
  }

  // 2. Characters
  for (const char of project.characters || []) {
    const name = char.name || '';
    const bio = char.description || char.role || '';
    const arc = char.notes || '';
    const combinedText = `${name} ${bio} ${arc}`;
    const score = calcScore(combinedText, name);

    if (score > 0) {
      results.push({
        id: char.id,
        type: 'character',
        title: name,
        snippet: bio || '',
        score: score + 2, // Boost entity hits
        metadata: { role: char.role },
      });
    }
  }

  // 3. Locations
  for (const loc of project.locations || []) {
    const name = loc.name || '';
    const desc = loc.description || loc.notes || '';
    const combinedText = `${name} ${desc}`;
    const score = calcScore(combinedText, name);

    if (score > 0) {
      results.push({
        id: loc.id,
        type: 'location',
        title: name,
        snippet: desc || name,
        score: score + 2,
      });
    }
  }

  // 4. Storyboard Shots / Panels
  for (const panel of project.panels || []) {
    const prompt = panel.generatedPrompt || panel.customPrompt || '';
    const status = panel.status || '';
    const score = calcScore(prompt);

    if (score > 0) {
      results.push({
        id: panel.id || `panel-${Math.random()}`,
        type: 'shot',
        title: `Shot Panel (${panel.sceneId || 'unassigned'})`,
        snippet: prompt.slice(0, 150),
        score,
        metadata: { sceneId: panel.sceneId },
      });
    }
  }

  // 5. Project rules / overview notes
  if (project.notes) {
    const score = calcScore(project.notes, 'Project Rules & Notes');
    if (score > 0) {
      results.push({
        id: 'project-notes',
        type: 'rule',
        title: 'Project Rules & Notes',
        snippet: project.notes.slice(0, 200),
        score,
      });
    }
  }

  // Sort descending by score
  const ranked = results.sort((a, b) => b.score - a.score).slice(0, 15);
  traceScenePayload('searchProject.sceneResults', ranked.filter(result => result.type === 'scene').map(result => result.id), { scannedSceneCount: project.scenes.length, rankedResultLimit: 15 });
  return ranked;
}
