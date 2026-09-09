import {
  uid,
  type Scene,
  type Block,
  type Person,
  type Place,
  type StoryboardShotIntent,
  type ShotSize,
  type CameraAngle,
  type CameraMovement,
  type ShotPurpose,
} from './project';

export interface SceneStoryboardPlan {
  sceneId: string;
  detectedBeatsCount: number;
  speakingCharacters: string[];
  locationName: string;
  propsFound: string[];
  suggestedPanels: StoryboardShotIntent[];
}

const REACTION_VERBS = [
  'looks',
  'stares',
  'hesitates',
  'smiles',
  'cries',
  'freezes',
  'realises',
  'realizes',
  'turns',
  'breathes',
  'sighs',
  'flinches',
  'prepares',
  'chusthadu',
  'chusthundi',
  'navvuthundi',
  'shocked',
  'surprised',
  'pauses',
  'nods',
  'gasps',
  'glares',
  'frowns',
  'winces',
];

const PROP_TERMS = [
  'resume',
  'phone',
  'letter',
  'photo',
  'photograph',
  'watch',
  'key',
  'keys',
  'gun',
  'weapon',
  'screen',
  'laptop',
  'computer',
  'message',
  'bag',
  'suitcase',
  'door',
  'window',
  'cup',
  'glass',
  'coffee',
  'bottle',
  'mirror',
  'card',
  'id card',
  'book',
  'passport',
];

const MOVEMENT_VERBS = [
  'walks',
  'runs',
  'enters',
  'leaves',
  'crosses',
  'approaches',
  'stands',
  'sits',
  'steps',
  'drives',
  'rushes',
  'paces',
  'backs away',
  'advances',
];

function formatPanelNumber(sceneIndex: number, panelIndex: number): string {
  const sceneStr = String(sceneIndex + 1).padStart(2, '0');
  const letter = String.fromCharCode(65 + (panelIndex % 26));
  return `${sceneStr}${letter}`;
}

export function planSceneStoryboard(
  scene: Scene,
  sceneIndex: number,
  allCharacters: Person[] = [],
  allLocations: Place[] = [],
): SceneStoryboardPlan {
  const shots: StoryboardShotIntent[] = [];
  const speakingSet = new Set<string>();
  const propsSet = new Set<string>();

  // Identify location
  const location = allLocations.find((l) => l.id === scene.locationId);
  const locationName =
    location?.name ??
    scene.heading
      .replace(/^(INT\.?\s*\/\s*EXT\.?|INT\.?|EXT\.?)\s*/i, '')
      .split(/\s[-–—]\s/)[0]
      .trim();

  // Find all characters involved in the scene
  const charactersInScene = allCharacters.filter((c) =>
    scene.characterIds.includes(c.id) ||
    scene.blocks.some((b) =>
      b.type === 'character' &&
      b.content.toUpperCase().includes(c.name.toUpperCase()),
    ),
  );

  // Collect speaking characters
  for (const block of scene.blocks) {
    if (block.type === 'character' && block.content.trim()) {
      const cleanName = block.content.replace(/\s*\(.*?\)\s*/g, '').trim();
      speakingSet.add(cleanName);
    }
  }

  // Scan for props in action blocks
  for (const block of scene.blocks) {
    if (block.type === 'action' || block.type === 'general') {
      const text = block.content.toLowerCase();
      for (const prop of PROP_TERMS) {
        if (new RegExp(`\\b${prop}\\b`, 'i').test(text)) {
          propsSet.add(prop);
        }
      }
    }
  }

  // 1. Establishing Shot: Always establish the scene first
  const initialAction =
    scene.blocks.find((b) => b.type === 'action')?.content || scene.summary || scene.heading;

  shots.push({
    id: uid(),
    sceneId: scene.id,
    panelNumber: formatPanelNumber(sceneIndex, shots.length),
    shotSize: 'wide',
    angle: 'eye_level',
    movement: 'static',
    purpose: 'establish',
    description: `Establishing shot of ${scene.heading}. ${initialAction.slice(0, 140)}`.trim(),
    locationId: scene.locationId,
    characterIds: charactersInScene.map((c) => c.id),
    duration: 3,
    lens: '35mm',
  });

  // 2. Iterate through blocks to construct dramatic visual beats
  let lastSpeaker = '';
  let lastActionSubject = '';

  for (let i = 0; i < scene.blocks.length; i++) {
    const block = scene.blocks[i];
    const text = block.content.trim();
    if (!text) continue;

    // Prop Insert Beat
    if (block.type === 'action' || block.type === 'general') {
      const lower = text.toLowerCase();
      let foundProp: string | null = null;
      for (const prop of PROP_TERMS) {
        if (new RegExp(`\\b${prop}\\b`, 'i').test(lower)) {
          foundProp = prop;
          break;
        }
      }

      if (foundProp && !shots.some((s) => s.purpose === 'insert' && s.description.toLowerCase().includes(foundProp!))) {
        shots.push({
          id: uid(),
          sceneId: scene.id,
          panelNumber: formatPanelNumber(sceneIndex, shots.length),
          shotSize: 'insert',
          angle: 'eye_level',
          movement: 'static',
          purpose: 'insert',
          description: `Detail insert of the ${foundProp}: ${text.slice(0, 120)}`.trim(),
          locationId: scene.locationId,
          characterIds: [],
          propIds: [foundProp],
          duration: 2,
          lens: '85mm',
        });
        continue;
      }

      // Reaction Verb Beat
      let isReaction = false;
      for (const rx of REACTION_VERBS) {
        if (new RegExp(`\\b${rx}\\b`, 'i').test(lower)) {
          isReaction = true;
          break;
        }
      }

      if (isReaction && shots.length < 8) {
        // Find matching character
        const matchedChar = charactersInScene.find((c) =>
          lower.includes(c.name.toLowerCase()),
        );
        shots.push({
          id: uid(),
          sceneId: scene.id,
          panelNumber: formatPanelNumber(sceneIndex, shots.length),
          shotSize: 'close_up',
          angle: 'eye_level',
          movement: 'push_in',
          purpose: 'reaction',
          description: text.slice(0, 140),
          locationId: scene.locationId,
          characterIds: matchedChar ? [matchedChar.id] : [],
          duration: 2,
          lens: '50mm',
        });
        continue;
      }

      // Movement Beat
      let isMovement = false;
      for (const mv of MOVEMENT_VERBS) {
        if (new RegExp(`\\b${mv}\\b`, 'i').test(lower)) {
          isMovement = true;
          break;
        }
      }

      if (isMovement && shots.length < 8 && shots.at(-1)?.purpose !== 'action') {
        shots.push({
          id: uid(),
          sceneId: scene.id,
          panelNumber: formatPanelNumber(sceneIndex, shots.length),
          shotSize: 'medium_wide',
          angle: 'eye_level',
          movement: 'tracking',
          purpose: 'action',
          description: text.slice(0, 140),
          locationId: scene.locationId,
          characterIds: charactersInScene.map((c) => c.id),
          duration: 3,
          lens: '35mm',
        });
      }
    }

    // Dialogue Beat
    if (block.type === 'character') {
      const speaker = text.replace(/\s*\(.*?\)\s*/g, '').trim();
      const dialogueBlock = scene.blocks[i + 1]?.type === 'dialogue' ? scene.blocks[i + 1] : null;
      const dialogueText = dialogueBlock?.content.trim() || '';

      if (speaker && (speaker !== lastSpeaker || shots.filter((s) => s.purpose === 'dialogue').length < 2)) {
        lastSpeaker = speaker;
        const matchedChar = charactersInScene.find(
          (c) => c.name.toUpperCase() === speaker.toUpperCase(),
        );

        // If multiple characters, alternate with over_shoulder or two_shot
        const hasMultiple = charactersInScene.length >= 2 || speakingSet.size >= 2;
        const shotSize: ShotSize = hasMultiple && shots.length % 2 === 0 ? 'over_shoulder' : 'medium';

        shots.push({
          id: uid(),
          sceneId: scene.id,
          panelNumber: formatPanelNumber(sceneIndex, shots.length),
          shotSize,
          angle: 'eye_level',
          movement: 'static',
          purpose: 'dialogue',
          description: `${speaker}: "${dialogueText.slice(0, 100)}"`.trim(),
          locationId: scene.locationId,
          characterIds: matchedChar ? [matchedChar.id] : [],
          duration: Math.max(2, Math.min(5, Math.ceil(dialogueText.length / 25))),
          lens: shotSize === 'over_shoulder' ? '50mm' : '50mm',
        });
      }
    }
  }

  // Ensure reasonable bounds (between 2 and 6 shots per scene typically)
  const finalShots = shots.slice(0, 8);

  return {
    sceneId: scene.id,
    detectedBeatsCount: finalShots.length,
    speakingCharacters: Array.from(speakingSet),
    locationName: locationName || 'Unknown Location',
    propsFound: Array.from(propsSet),
    suggestedPanels: finalShots,
  };
}
