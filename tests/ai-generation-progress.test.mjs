import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationProgress, generationStatus } from '../lib/ai/generation-progress.ts';

function setup(t) {
  const states = [];
  const progress = createGenerationProgress(state => states.push(state));
  t.after(() => progress.dispose());
  return { progress, states, latest: () => states.at(-1) };
}

test('send synchronously shows reading context', t => {
  const { progress, latest } = setup(t);
  progress.start();
  assert.equal(latest().stage, 'building_context');
  assert.equal(generationStatus(latest().stage), 'Reading project context…');
});
test('context completion changes activity to waiting for model', t => {
  const { progress, latest } = setup(t);
  progress.start().waiting();
  assert.equal(latest().stage, 'waiting_for_model');
  assert.equal(generationStatus(latest().stage), 'Drafting response…');
});
test('first content removes waiting status and subsequent chunks accumulate', t => {
  const { progress, latest } = setup(t);
  const request = progress.start();
  request.waiting(); request.chunk('');
  assert.equal(latest().stage, 'waiting_for_model');
  request.chunk('Hello'); request.chunk(' there');
  assert.equal(latest().stage, 'streaming');
  assert.equal(generationStatus(latest().stage), null);
  assert.equal(latest().content, 'Hello there');
});
test('completion clears generation activity', t => {
  const { progress, latest } = setup(t);
  progress.start().complete();
  assert.equal(latest().stage, 'idle');
  assert.equal(generationStatus(latest().stage), null);
});
test('failure clears loading and allows retry', t => {
  const { progress, latest } = setup(t);
  progress.start().fail();
  assert.equal(latest().stage, 'error');
  assert.equal(generationStatus(latest().stage), null);
  assert.ok(progress.start());
});
test('stop clears activity immediately and ignores late callbacks from cancelled request', t => {
  const { progress, latest } = setup(t);
  const old = progress.start(); old.chunk('Partial');
  assert.equal(progress.cancel(), 'Partial');
  assert.equal(old.signal.aborted, true);
  assert.equal(latest().stage, 'idle');
  progress.start(); old.chunk('late'); old.complete(); old.fail(); old.waiting();
  assert.equal(latest().stage, 'building_context');
  assert.equal(latest().content, '');
});
test('duplicate sends cannot start another active generation', t => {
  const { progress, states } = setup(t);
  progress.start();
  assert.equal(progress.start(), null);
  assert.equal(states.length, 1);
});
test('elapsed timer updates once per second and is cleaned on complete, error, cancel and unmount', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { progress, states, latest } = setup(t);
  for (const end of ['complete', 'fail', 'cancel', 'dispose']) {
    const request = progress.start();
    t.mock.timers.tick(3000);
    assert.equal(latest().elapsedMs, 3000);
    assert.equal(request.elapsed(), 3000);
    if (end === 'cancel' || end === 'dispose') progress[end]();
    else request[end]();
    const count = states.length;
    t.mock.timers.tick(10000);
    assert.equal(states.length, count);
  }
});
