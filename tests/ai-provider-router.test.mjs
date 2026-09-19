// Tests: Provider/Router — primary success, fallback, auth failure, cancellation
import { test, describe, assert } from 'node:test';
import { strict as strictAssert } from 'node:assert';

// Import just the classification logic & isRecoverableFailure (no real HTTP calls)
import { classifyError, isRecoverableFailure } from '../lib/ai/router.ts';

describe('Failure classification', () => {
  test('classifies 401 as authentication', () => {
    const err = new Error('Unauthorized');
    err.status = 401;
    strictAssert.equal(classifyError(err), 'authentication');
  });

  test('classifies 429 as rate_limit', () => {
    const err = new Error('Too many requests');
    err.status = 429;
    strictAssert.equal(classifyError(err), 'rate_limit');
  });

  test('classifies 503 as capacity', () => {
    const err = new Error('Server overloaded');
    err.status = 503;
    strictAssert.equal(classifyError(err), 'capacity');
  });

  test('classifies 500 as server_error', () => {
    const err = new Error('Internal server error');
    err.status = 500;
    strictAssert.equal(classifyError(err), 'server_error');
  });

  test('classifies 404 with model-not-found message as model_unavailable', () => {
    const err = new Error('Model not found');
    err.status = 404;
    strictAssert.equal(classifyError(err), 'model_unavailable');
  });

  test('classifies context_limit by message', () => {
    const err = new Error('context length exceeded maximum context');
    strictAssert.equal(classifyError(err), 'context_limit');
  });

  test('classifies AbortError as cancelled', () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    strictAssert.equal(classifyError(err), 'cancelled');
  });

  test('classifies safety message as safety', () => {
    const err = new Error('content_filter violation safety');
    strictAssert.equal(classifyError(err), 'safety');
  });
});

describe('Recoverable failure detection', () => {
  test('timeout is recoverable', () => {
    strictAssert.equal(isRecoverableFailure('timeout'), true);
  });

  test('rate_limit is recoverable', () => {
    strictAssert.equal(isRecoverableFailure('rate_limit'), true);
  });

  test('capacity is recoverable', () => {
    strictAssert.equal(isRecoverableFailure('capacity'), true);
  });

  test('server_error is recoverable', () => {
    strictAssert.equal(isRecoverableFailure('server_error'), true);
  });

  test('model_unavailable is recoverable', () => {
    strictAssert.equal(isRecoverableFailure('model_unavailable'), true);
  });

  test('context_limit is NOT recoverable', () => {
    strictAssert.equal(isRecoverableFailure('context_limit'), false);
  });

  test('authentication is NOT recoverable (no fallback on auth errors)', () => {
    strictAssert.equal(isRecoverableFailure('authentication'), false);
  });

  test('invalid_request is NOT recoverable', () => {
    strictAssert.equal(isRecoverableFailure('invalid_request'), false);
  });

  test('safety is NOT recoverable (no model-shopping around safety refusals)', () => {
    strictAssert.equal(isRecoverableFailure('safety'), false);
  });

  test('cancelled is NOT recoverable (user cancellation does not trigger fallback)', () => {
    strictAssert.equal(isRecoverableFailure('cancelled'), false);
  });
});

import { ModelRouter } from '../lib/ai/router.ts';
import { buildAlternativesRepairInstruction, buildProposalProviderInstruction } from '../lib/ai/proposal-request.ts';
const routeSettings={sarvam:{apiKey:'test',model:'first'},openaiCompatible:{name:'Test',apiKey:'test',baseUrl:'https://example.test',model:'second'},activeProviderId:'auto',routing:{primaryProviderId:'sarvam',primaryModel:'first',fallbacks:[{providerId:'openai-compatible',model:'second'}]}};
function stubRouter(error){
 const router=new ModelRouter(routeSettings);let fallbackCalls=0;
 const primary={generate:async()=>{throw error},stream:async()=>{throw error}};
 const secondary={generate:async()=>{fallbackCalls++;return {providerId:'openai-compatible',model:'second',content:'ok'}},stream:async()=>{fallbackCalls++;return {providerId:'openai-compatible',model:'second',content:'ok'}}};
 router.providers=new Map([['sarvam',primary],['openai-compatible',secondary]]);
 return {router,calls:()=>fallbackCalls};
}

test('Sarvam Alternatives resolves to sarvam-105b', () => {
  const model = ModelRouter.resolveModelForIntent({ provider: 'sarvam', configuredModel: 'sarvam-105b', intent: 'alternatives' });
  strictAssert.equal(model, 'sarvam-105b');
  strictAssert.ok(!model.includes('30b'));
});

test('other Sarvam intents remain on configured default model', () => {
  const model = ModelRouter.resolveModelForIntent({ provider: 'sarvam', configuredModel: 'sarvam-105b', intent: 'tighten' });
  strictAssert.equal(model, 'sarvam-105b');
});

test('non-Sarvam provider routing remains unchanged', () => {
  const model = ModelRouter.resolveModelForIntent({ provider: 'openai-compatible', configuredModel: 'gpt-4o-mini', intent: 'alternatives' });
  strictAssert.equal(model, 'gpt-4o-mini');
});

test('Alternatives request stays isolated, exact schema, and reasoning disabled with 4096 budget', async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(init.body);
    return new Response('data: {"choices":[{"delta":{"content":"{\\"alternatives\\":[]}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  try {
    const router = new ModelRouter({
      sarvam: { apiKey: 'test-key', model: 'sarvam-105b' },
      openaiCompatible: { name: 'Test', baseUrl: 'https://example.test/v1', apiKey: '', model: 'test' },
      activeProviderId: 'sarvam',
      routing: { primaryProviderId: 'sarvam', primaryModel: 'sarvam-105b', fallbacks: [] },
    });
    await router.stream({
      messages: [{ role: 'user', content: 'Return JSON.' }],
      diagnostics: { requestId: 'ALT-route', intent: 'alternatives', sourceBlocks: [{ id: 'a1', type: 'action', text: 'Hello' }] },
      temperature: 0.2,
      maxTokens: 4096,
      reasoningEffort: null,
    }, () => {});
    strictAssert.equal(payload.model, 'sarvam-105b');
    strictAssert.equal(payload.temperature, 0.2);
    strictAssert.equal(payload.max_tokens, 4096);
    strictAssert.equal(payload.reasoning_effort, null);
    strictAssert.equal(payload.messages[0].role, 'user');
    strictAssert.equal(payload.messages.some((message) => message.content.includes('Earlier unrelated request.')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Alternatives contract text includes EXACTLY 3, full schema shape, and language guardrails in both initial and repair prompts', () => {
  const initialInstruction = buildProposalProviderInstruction('Rewrite', 'alternatives', { sceneId: 'scene-1', sourceRevision: 'rev-1', selectedBlockIds: ['a1', 'b2'], selectedText: 'Hello', blockTypes: ['action', 'dialogue'] }, [
    { id: 'a1', type: 'action', content: 'Face kadukoni mirror lo chusthundi.' },
    { id: 'b2', type: 'dialogue', content: 'Konni seconds.' },
  ]);
  strictAssert.match(initialInstruction, /EXACTLY 3/i, 'initial must contain EXACTLY 3');
  strictAssert.doesNotMatch(initialInstruction, /2 or 3/i, 'initial must not say 2 or 3');
  strictAssert.doesNotMatch(initialInstruction, /up to 3/i, 'initial must not say up to 3');
  strictAssert.match(initialInstruction, /\"alternatives\"/i);
  strictAssert.match(initialInstruction, /\"sourceBlockId\"/i);
  strictAssert.match(initialInstruction, /Do not return 1 alternative/);
  strictAssert.match(initialInstruction, /Do not return 2 alternatives/);
  strictAssert.match(initialInstruction, /Each alternative contains exactly ONE replace operation/);
  strictAssert.match(initialInstruction, /language mixture/i);
  strictAssert.match(initialInstruction, /romanized Telugu\/Tenglish/i);

  const repairInstruction = buildAlternativesRepairInstruction(
    { sceneId: 'scene-1', sourceRevision: 'rev-1', selectedBlockIds: ['a1', 'b2'], selectedText: 'Hello', blockTypes: ['action', 'dialogue'] },
    [
      { id: 'a1', type: 'action', content: 'Face kadukoni mirror lo chusthundi.' },
      { id: 'b2', type: 'dialogue', content: 'Konni seconds.' },
    ],
  );
  strictAssert.match(repairInstruction, /EXACTLY 3/i, 'repair must contain EXACTLY 3');
  strictAssert.doesNotMatch(repairInstruction, /2 or 3/i, 'repair must not say 2 or 3');
  strictAssert.match(repairInstruction, /Do not return 1 alternative/);
  strictAssert.match(repairInstruction, /Do not return 2 alternatives/);
  strictAssert.match(repairInstruction, /Each alternative contains exactly ONE replace operation/);
  strictAssert.match(repairInstruction, /\"sourceBlockId\"/i);
  strictAssert.match(repairInstruction, /Your previous response contained only 1 alternative/);
  strictAssert.match(repairInstruction, /Return EXACTLY 3 alternatives/);
  strictAssert.match(repairInstruction, /a1/, 'repair must embed the real source block ID');

  const repairTwo = buildAlternativesRepairInstruction(
    { sceneId: 'scene-1', sourceRevision: 'rev-1', selectedBlockIds: ['a1', 'b2'], selectedText: 'Hello', blockTypes: ['action', 'dialogue'] },
    [{ id: 'a1', type: 'action', content: 'Face kadukoni mirror lo chusthundi.' }],
    'Alternatives must contain exactly 3 candidates.',
    2,
  );
  strictAssert.match(repairTwo, /only 2 alternatives/, 'repair with candidateCount=2 must say only 2');
  strictAssert.match(repairTwo, /EXACTLY 3/i);
});

for(const method of ['execute','stream']){
 test(`${method}: fallback occurs only for recoverable infrastructure failures`,async()=>{
  for(const error of [new Error('timeout'),Object.assign(new Error('rate limit'),{status:429}),Object.assign(new Error('capacity'),{status:503}),Object.assign(new Error('server'),{status:500}),Object.assign(new Error('model not found'),{status:404})]){
   const {router,calls}=stubRouter(error);const response=await router[method]({messages:[]},...(method==='stream'?[()=>{}]:[]));strictAssert.equal(calls(),1);strictAssert.equal(response.fallback.usedModel,'second');
  }
 });
 test(`${method}: auth, malformed requests, cancellation and safety never trigger fallback`,async()=>{
  for(const error of [Object.assign(new Error('Unauthorized'),{status:401}),Object.assign(new Error('bad request capacity'),{status:400}),Object.assign(new Error('Aborted'),{name:'AbortError'}),Object.assign(new Error('safety content filter'),{status:503})]){
   const {router,calls}=stubRouter(error);await strictAssert.rejects(()=>router[method]({messages:[]},...(method==='stream'?[()=>{}]:[])));strictAssert.equal(calls(),0);
  }
 });
 test(`${method}: missing credentials and pre-cancelled requests do not route elsewhere`,async()=>{
  const {router,calls}=stubRouter(new Error('unused'));router.providers.delete('sarvam');await strictAssert.rejects(()=>router[method]({messages:[]},...(method==='stream'?[()=>{}]:[])));strictAssert.equal(calls(),0);
  await strictAssert.rejects(()=>router[method]({messages:[],abortSignal:AbortSignal.abort()},...(method==='stream'?[()=>{}]:[])),{name:'AbortError'});strictAssert.equal(calls(),0);
 });
}
