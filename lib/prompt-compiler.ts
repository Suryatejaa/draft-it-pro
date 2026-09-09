import {
  type Scene,
  type Person,
  type Place,
  type StoryboardShotIntent,
  type ShotSize,
  type CameraAngle,
  type CameraMovement,
} from './project';

export function computeSceneContentHash(scene: Scene): string {
  const payload = [
    scene.heading,
    scene.locationId,
    scene.emotion ?? '',
    scene.summary ?? '',
    ...scene.blocks.map((b) => `${b.type}:${b.content.trim()}`),
  ].join('|');

  // Simple, fast deterministic 32-bit FNV-1a hash formatted as hex
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function shotSizeLabel(size: ShotSize): string {
  switch (size) {
    case 'extreme_wide':
      return 'Extreme Wide';
    case 'wide':
      return 'Wide';
    case 'medium_wide':
      return 'Medium Wide';
    case 'medium':
      return 'Medium';
    case 'medium_close':
      return 'Medium Close-Up';
    case 'close_up':
      return 'Close-Up';
    case 'extreme_close_up':
      return 'Extreme Close-Up';
    case 'insert':
      return 'Insert Detail';
    case 'over_shoulder':
      return 'Over-the-Shoulder';
    case 'two_shot':
      return 'Two-Shot';
    default:
      return 'Medium';
  }
}

export function cameraAngleLabel(angle: CameraAngle): string {
  switch (angle) {
    case 'eye_level':
      return 'Eye-level';
    case 'high':
      return 'High angle';
    case 'low':
      return 'Low angle';
    case 'top_down':
      return 'Top-down overhead';
    case 'dutch':
      return 'Dutch tilt angle';
    default:
      return 'Eye-level';
  }
}

export function cameraMovementLabel(movement: CameraMovement): string {
  switch (movement) {
    case 'static':
      return 'Static';
    case 'pan':
      return 'Slow pan';
    case 'tilt':
      return 'Tilt';
    case 'push_in':
      return 'Slow push-in';
    case 'pull_out':
      return 'Pull-out';
    case 'tracking':
      return 'Tracking movement';
    case 'handheld':
      return 'Handheld kinetic';
    default:
      return 'Static';
  }
}

export function buildStoryboardPrompt(
  scene: Scene,
  shot: StoryboardShotIntent,
  allCharacters: Person[] = [],
  location?: Place,
  aspectRatio = '16:9',
  style: 'pencil' | 'marker' | 'ink' | 'grayscale' | 'line_art' = 'pencil',
): string {
  const sizeText = shotSizeLabel(shot.shotSize);
  const angleText = cameraAngleLabel(shot.angle);
  const movementText = cameraMovementLabel(shot.movement);
  const lensText = shot.lens || (shot.shotSize === 'wide' ? '35mm' : shot.shotSize === 'close_up' ? '50mm' : '50mm');

  // Style line
  const styleHeader =
    style === 'marker'
      ? `Film storyboard marker sketch, cinematic ${sizeText.toLowerCase()} shot.`
      : style === 'ink'
      ? `High-contrast ink film storyboard illustration, cinematic ${sizeText.toLowerCase()} shot.`
      : `Black-and-white cinematic storyboard pencil sketch, ${sizeText.toLowerCase()} shot.`;

  // Scene & Setting
  const settingLine = `Scene: ${scene.heading}.`;

  // Location Visual Profile
  let locationDesc = '';
  if (location?.visualDescription?.trim()) {
    locationDesc = `Location visual appearance: ${location.visualDescription.trim()}`;
  } else if (location?.description?.trim()) {
    locationDesc = `Location details: ${location.description.trim()}`;
  } else {
    locationDesc = `Setting: ${scene.heading.replace(/^(INT\.|EXT\.|INT\.\/EXT\.)\s*/i, '').split(/\s[-–—]\s/)[0].trim()}`;
  }

  // Character Visual Profiles
  const activeCharacters = allCharacters.filter((c) =>
    shot.characterIds.includes(c.id),
  );

  let subjectsDesc = '';
  if (activeCharacters.length > 0) {
    subjectsDesc = activeCharacters
      .map((c) => {
        const visual = c.visualDescription?.trim() || c.description?.trim();
        return visual ? `${c.name} (${visual})` : `${c.name}`;
      })
      .join('; ');
    subjectsDesc = `Subjects in frame: ${subjectsDesc}.`;
  } else if (shot.purpose === 'insert') {
    subjectsDesc = `Focus object: ${shot.description}.`;
  }

  // Action / Staging
  const actionLine = `Action & Staging: ${shot.description}.`;

  // Camera Framing
  const cameraLine = `Camera: ${sizeText}, ${angleText}, ${lensText} equivalent lens, ${movementText}.`;

  // Lighting & Mood
  const isNight = /NIGHT/i.test(scene.heading);
  const lighting = isNight ? 'Low-key evening / interior cinematic lighting' : 'Natural daylight cinematic ambient lighting';
  const mood = scene.emotion ? `${scene.emotion}, focused cinematic tone` : 'Restrained cinematic tension';
  const lightingLine = `Lighting & Mood: ${lighting}; ${mood}.`;

  // Production Storyboard Constraints
  const constraints = [
    'Black-and-white hand-drawn production storyboard pencil sketch.',
    'Loose confident graphite linework with minimal grayscale shading.',
    'Clear readable silhouettes and staging.',
    'No color.',
    'No text, no letters, no subtitles, no speech bubbles.',
    `${aspectRatio} frame.`,
  ];

  return [
    styleHeader,
    settingLine,
    locationDesc,
    ...(subjectsDesc ? [subjectsDesc] : []),
    actionLine,
    cameraLine,
    lightingLine,
    ...constraints,
  ].join('\n');
}
