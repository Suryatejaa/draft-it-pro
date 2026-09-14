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
const routeSettings={sarvam:{apiKey:'test',model:'first'},openaiCompatible:{name:'Test',apiKey:'test',baseUrl:'https://example.test',model:'second'},activeProviderId:'auto',routing:{primaryProviderId:'sarvam',primaryModel:'first',fallbacks:[{providerId:'openai-compatible',model:'second'}]}};
function stubRouter(error){
 const router=new ModelRouter(routeSettings);let fallbackCalls=0;
 const primary={generate:async()=>{throw error},stream:async()=>{throw error}};
 const secondary={generate:async()=>{fallbackCalls++;return {providerId:'openai-compatible',model:'second',content:'ok'}},stream:async()=>{fallbackCalls++;return {providerId:'openai-compatible',model:'second',content:'ok'}}};
 router.providers=new Map([['sarvam',primary],['openai-compatible',secondary]]);
 return {router,calls:()=>fallbackCalls};
}
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
