import { traceScenePayload } from "./scene-payload.ts";
import { getEpisodeSceneScope } from "./episode-scenes.ts";
import type { Project, Scene, Person, Place } from "../project";

export interface BuildContextOptions {
  rootProject: Project;
  activeWorkspace?: Project;
  activeView?: string;
  activeActId?: string; // Diagnostics only; never restricts episode retrieval.
  currentSceneId?: string;
  selectedBlockIds?: string[];
  selectedText?: string;
  selectionBlockTypes?: string[];
  sourceRevision?: string;
  userQuery?: string;
}

export interface BuiltAgentContext {
  systemPromptAddendum: string;
  formattedContext: string;
  retrieval: {
    projectId: string;
    episodeId?: string;
    activeSceneId?: string;
    includedSceneIds: string[];
    neighboringSceneIds: string[];
    fullScriptSceneIds: string[];
    complete: false;
  };
  activeContextSummary: string; // E.g. "S01 E01 · Scene 5 · Screenplay"
}

// Helper to strip sensitive private contact info from character/crew objects
function sanitizeCharacter(person: Person): Partial<Person> {
  const safe = { ...person } as any;
  delete safe.phone;
  delete safe.email;
  delete safe.address;
  delete safe.contractInfo;
  delete safe.rate;
  return safe;
}

export function buildAgentContext(
  options: BuildContextOptions,
): BuiltAgentContext {
  const {
    rootProject,
    activeWorkspace,
    activeView = "Screenplay",
    currentSceneId,
    selectedBlockIds = [],
    selectedText = "",
    selectionBlockTypes = [],
    sourceRevision = "",
  } = options;

  const currentProj = getEpisodeSceneScope(
    rootProject,
    activeWorkspace,
  ).project;
  const isEpisode = currentProj.id !== rootProject.id;

  // Build active context summary tag for UI
  let contextTagParts: string[] = [];
  if (isEpisode) {
    const epNum = currentProj.episodeNumber || 1;
    const sNum = currentProj.seasonNumber || 1;
    contextTagParts.push(
      `S${String(sNum).padStart(2, "0")} E${String(epNum).padStart(2, "0")}`,
    );
  } else {
    contextTagParts.push(rootProject.title || "Project");
  }

  const allScenes = currentProj.scenes || [];
  let currentSceneIndex = -1;
  let activeScene: Scene | undefined;

  if (currentSceneId) {
    currentSceneIndex = allScenes.findIndex((s) => s.id === currentSceneId);
    if (currentSceneIndex !== -1) {
      activeScene = allScenes[currentSceneIndex];
    }
  }

  if (activeScene) {
    contextTagParts.push(`Scene ${activeScene.id}`);
  }
  contextTagParts.push(activeView);
  const activeContextSummary = contextTagParts.join(" · ");

  const sections: string[] = [];
  const includedSceneIds: string[] = [];
  const neighboringSceneIds: string[] = [];
  const fullScriptSceneIds: string[] = [];
  const hasSelection = selectedText || selectedBlockIds.length > 0;

  // 1. High-level Project Context
  sections.push(`=== PROJECT OVERVIEW ===
Title: ${rootProject.title}
Format: ${rootProject.format}
Genre: ${rootProject.genre || "Unspecified"}
Logline: ${rootProject.logline || "None"}
Premise: ${rootProject.premise || "None"}
Theme: ${rootProject.theme || "None"}
${rootProject.notes ? `Project Rules & Notes: ${rootProject.notes}\n` : ""}`);

  // 2. Episode Context (if inside an episode)
  if (isEpisode) {
    sections.push(`=== EPISODE OVERVIEW ===
Episode: Season ${currentProj.seasonNumber || 1}, Episode ${currentProj.episodeNumber || 1} - ${currentProj.title}
Episode Logline: ${currentProj.logline || "None"}
Episode Synopsis: ${currentProj.synopsis || "None"}`);
  }

  if (hasSelection) {
    const selectedBlocks =
      activeScene?.blocks.filter((block) =>
        selectedBlockIds.includes(block.id),
      ) ?? [];
    const selectionContent = selectedBlocks.length
      ? selectedBlocks
          .map((block) => `[${block.type.toUpperCase()}] ${block.content}`)
          .join("\n")
      : selectedText;
    if (selectionContent)
      sections.push(
        `=== WRITER'S CURRENT SELECTION (HIGHEST PRIORITY) ===\nBlock IDs: ${selectedBlockIds.join(", ") || "Unavailable"}\nBlock types: ${selectionBlockTypes.join(", ") || selectedBlocks.map((block) => block.type).join(", ") || "Unavailable"}\nSource revision: ${sourceRevision || "Unavailable"}\n${selectionContent}`,
      );
  }

  // 3. View & Local Context
  if (activeView === "Screenplay" || activeView === "Story") {
    if (activeScene) {
      const prevScene =
        currentSceneIndex > 0 ? allScenes[currentSceneIndex - 1] : undefined;
      const nextScene =
        currentSceneIndex < allScenes.length - 1
          ? allScenes[currentSceneIndex + 1]
          : undefined;

      includedSceneIds.push(activeScene.id);
      fullScriptSceneIds.push(activeScene.id);
      for (const neighbor of [prevScene, nextScene])
        if (neighbor) {
          includedSceneIds.push(neighbor.id);
          neighboringSceneIds.push(neighbor.id);
        }
      const sceneChars = (currentProj.characters || [])
        .filter((c) => (activeScene?.characterIds || []).includes(c.id))
        .map((c) => sanitizeCharacter(c));

      const sceneLocation = (currentProj.locations || []).find(
        (l) => l.id === activeScene?.locationId,
      );

      let sceneText = `=== CURRENT SCENE (${activeScene.heading}) ===
Act: ${activeScene.act || "Act 1"}
Summary: ${activeScene.summary || "None"}
Characters Present: ${sceneChars.map((c) => c.name).join(", ") || "None"}
Story Location: ${sceneLocation?.name || "Unassigned"}${
        hasSelection
          ? ""
          : `
Blocks:
${activeScene.blocks.map((b) => `[${b.type.toUpperCase()}] ${b.content}`).join("\n")}`
      }`;

      if (prevScene) {
        sceneText =
          `=== PREVIOUS SCENE (${prevScene.heading}) ===\nSummary: ${prevScene.summary || "None"}\n\n` +
          sceneText;
      }
      if (nextScene) {
        sceneText += `\n\n=== NEXT SCENE (${nextScene.heading}) ===\nSummary: ${nextScene.summary || "None"}`;
      }

      sections.push(sceneText);
    } else {
      includedSceneIds.push(...allScenes.slice(0, 5).map((s) => s.id));
      // Limited overview; larger questions use tools.
      sections.push(`=== SCREENPLAY SCENES OVERVIEW ===
Total Scenes: ${allScenes.length}
Scene List:
${allScenes
  .slice(0, 5)
  .map((s) => `- ${s.heading} (${s.summary || "No summary"})`)
  .join("\n")}`);
    }
  } else if (activeView === "Characters" || activeView === "Cast & Crew") {
    const chars = (currentProj.characters || []).map((c) =>
      sanitizeCharacter(c),
    );
    sections.push(`=== CHARACTERS CONTEXT ===
${chars
  .map(
    (c) =>
      `Character: ${c.name} (${c.role || "Role unspecified"})\nDescription: ${c.description || "None"}\nArc: ${c.arc || "None"}\nGoals: ${c.goals || "None"}\nFear: ${c.fear || "None"}\nBackstory: ${c.backstory || "None"}`,
  )
  .join("\n\n")}`);
  } else if (activeView === "Scene cards") {
    includedSceneIds.push(...allScenes.slice(0, 5).map((s) => s.id));
    sections.push(`=== SCENE CARDS CONTEXT ===
${allScenes
  .slice(0, 5)
  .map(
    (s) =>
      `Scene: ${s.heading} | Act: ${s.act}\nSummary: ${s.summary || "None"}\nPurpose: ${s.purpose || "None"}`,
  )
  .join("\n\n")}`);
  } else if (activeView === "Shot Designer" || activeView === "Storyboard") {
    const panels = currentProj.panels || [];
    sections.push(`=== STORYBOARD / SHOTS CONTEXT ===
Active Scene: ${activeScene ? activeScene.heading : "All Scenes"}
Shots/Panels (${panels.length}):
${panels
  .slice(0, 10)
  .map(
    (p) =>
      `- Panel ${p.id}: Status ${p.status} | Prompt: ${p.generatedPrompt || p.customPrompt || "None"}`,
  )
  .join("\n")}`);
  } else {
    sections.push(`=== WORKSPACE CONTEXT (${activeView}) ===
Scenes: ${allScenes.length} | Characters: ${(currentProj.characters || []).length} | Locations: ${(currentProj.locations || []).length}`);
  }

  traceScenePayload("contextSceneSummaries.length", includedSceneIds, {
    contextSceneSummariesLength: includedSceneIds.length,
    scope: "local",
    activeSceneId: activeScene?.id,
  });
  const formattedContext = sections.join("\n\n");
  const systemPromptAddendum = `CURRENT CONTEXT SUMMARY: ${activeContextSummary}\nCONTEXT COVERAGE: PARTIAL. This is local context, not a complete episode/project screenplay. Use read-only tools for exhaustive lists, appearances and global analysis. Scene summaries do not establish all screenplay facts.`;

  return {
    retrieval: {
      projectId: rootProject.id,
      episodeId: isEpisode ? currentProj.id : undefined,
      activeSceneId: activeScene?.id,
      includedSceneIds,
      neighboringSceneIds,
      fullScriptSceneIds,
      complete: false,
    },
    systemPromptAddendum,
    formattedContext,
    activeContextSummary,
  };
}
