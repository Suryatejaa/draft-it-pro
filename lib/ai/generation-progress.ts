/** UI activity only; no provider progress is inferred. */
export type CoWriterGenerationStage = 'idle' | 'building_context' | 'waiting_for_model' | 'streaming' | 'error';
export type GenerationProgress = { stage: CoWriterGenerationStage; content: string; elapsedMs: number };
export const generationStatus = (stage: CoWriterGenerationStage) =>
  stage === 'building_context' ? 'Reading project context…' : stage === 'waiting_for_model' ? 'Drafting response…' : null;

export function createGenerationProgress(onChange: (state: GenerationProgress) => void) {
  let state: GenerationProgress = { stage: 'idle', content: '', elapsedMs: 0 };
  let controller: AbortController | null = null;
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const publish = () => onChange({ ...state });
  const clearTimer = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
  const finish = (stage: 'idle' | 'error') => {
    clearTimer();
    state = { ...state, stage, elapsedMs: Date.now() - startedAt };
    controller = null;
    publish();
  };
  return {
    start() {
      if (controller) return null;
      controller = new AbortController();
      const current = controller;
      startedAt = Date.now();
      state = { stage: 'building_context', content: '', elapsedMs: 0 };
      publish();
      timer = setInterval(() => { state.elapsedMs = Date.now() - startedAt; publish(); }, 1000);
      return {
        signal: current.signal,
        waiting(clearContent = false) { if (controller === current) { state.stage = 'waiting_for_model'; if (clearContent) state.content = ''; publish(); } },
        chunk(content: string) { if (controller === current && content) { state.stage = 'streaming'; state.content += content; publish(); } },
        complete() { if (controller === current) finish('idle'); },
        fail() { if (controller === current) finish('error'); },
        elapsed() { return Date.now() - startedAt; },
      };
    },
    cancel() {
      const content = state.content;
      controller?.abort();
      finish('idle');
      return content;
    },
    dispose() { controller?.abort(); controller = null; clearTimer(); },
  };
}
