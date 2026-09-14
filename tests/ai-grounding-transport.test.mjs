import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { AgentOrchestrator, MAX_TOOL_ROUNDS } from '../lib/ai/orchestrator.ts';
import { SarvamProvider } from '../lib/ai/providers/sarvam-provider.ts';
import { OpenAICompatibleProvider } from '../lib/ai/providers/openai-compatible-provider.ts';
import { buildAgentContext } from '../lib/ai/context-builder.ts';
import { CO_WRITER_SYSTEM_INSTRUCTION } from '../lib/ai/system-instructions.ts';
import { retrieveToolResult, initialReadOnlyQueries } from '../lib/ai/tools.ts';
import { SafeMarkdown } from '../components/ai/safe-markdown.ts';

const scenes = Array.from({length: 8}, (_, i) => ({ id: `s${i}`, heading: `INT. ROOM ${i} - ${i === 1 ? 'PRE-DAWN' : 'DAY'}`, summary: `Summary ${i}`, act: 'Act 1', characterIds: i % 2 === 0 ? ['sirisha'] : [], blocks: [{ id: `b${i}`, type: 'action', content: `Evidence ${i}` }] }));
const episode = { id: 'ep', title: 'Isha', kind: 'episode', scenes, characters: [{id:'sirisha', name:'Sirisha', description:'A writer'}], locations: [], panels: [] };
const root = { ...episode, id:'root', title:'Series', kind:'series', scenes:[], characters:[], episodes:[episode, { ...episode, id:'other', title:'Secret sibling' }] };
const settings = { sarvam:{apiKey:'test-only',model:'sarvam-105b'}, openaiCompatible:{apiKey:'',baseUrl:'',model:''}, activeProviderId:'auto', routing:{primaryProviderId:'sarvam',primaryModel:'sarvam-105b',fallbacks:[]} };
const options = {rootProject:root, activeWorkspace:episode, activeView:'Screenplay', currentSceneId:'s0', userQuery:'Analyse this scene'};
const toolCall = (name, args, id='call1') => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
function streamResponse(delta, finish='stop') {
  const body = `data: ${JSON.stringify({choices:[{delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:finish}]})}\n\ndata: [DONE]\n\n`;
  return new Response(body);
}
function inspectFetch(t, responder) {
  const payloads=[];
  t.mock.method(globalThis,'fetch',async (_url, init) => {const payload=JSON.parse(init.body);payloads.push(payload);return responder(payload,payloads.length);});
  return payloads;
}

test('global episode question retrieves every scoped scene through tools, without sibling or full snapshot',async t=>{
  const bodies=inspectFetch(t,()=>streamResponse({content:'Eight scenes.'}));
  await new AgentOrchestrator(settings).stream({...options,userQuery:'List every scene across this episode'},()=>{});
  const result=JSON.parse(bodies[0].messages.find(m=>m.role==='tool').content);
  assert.equal(result.data.length,8);assert.equal(result.complete,true);
  assert.equal(result.detail,'scene_summaries_only');
  assert.equal(result.scope.workspaceId,'ep');
  assert.ok(!JSON.stringify(bodies).includes('Secret sibling'));
  assert.ok(!JSON.stringify(bodies).includes('Evidence 7'));
  assert.equal(bodies[0].tools.length,13);
});
test('character appearance question retrieves all episode scenes and retains linked scene IDs as metadata',async t=>{
  const bodies=inspectFetch(t,()=>streamResponse({content:'Four appearances.'}));
  await new AgentOrchestrator(settings).stream({...options,userQuery:'Where does Sirisha appear?'},()=>{});
  const results=bodies[0].messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
  assert.deepEqual(results[0].data.sceneIds,['s0','s2','s4','s6']);
  assert.deepEqual(results[1].data.map(s=>s.id),scenes.map(scene=>scene.id));
  assert.deepEqual(results[1].data.filter(scene=>scene.characterIds.includes('sirisha')).map(scene=>scene.id),results[0].data.sceneIds);
  assert.equal(results[1].complete,true);
});
test('local question leaves entire episode out of the initial request',async t=>{
  const bodies=inspectFetch(t,()=>streamResponse({content:'Local analysis.'}));
  await new AgentOrchestrator(settings).stream(options,()=>{});
  assert.ok(!bodies[0].messages.some(m=>m.role==='tool'));
  assert.ok(!JSON.stringify(bodies).includes('Summary 7'));
  assert.ok(JSON.stringify(bodies).includes('Evidence 0'));
});
test('live streaming tool request reaches registry and correlated result reaches provider',async t=>{
  const before=structuredClone(root);
  const bodies=inspectFetch(t,(_p,n)=>n===1?streamResponse({tool_calls:[{index:0,...toolCall('getScene',{sceneId:'s6'})}]},'tool_calls'):streamResponse({content:'Evidence-based answer.'}));
  const chunks=[];
  const result=await new AgentOrchestrator(settings).stream(options,c=>chunks.push(c));
  assert.equal(bodies.length,2);
  const reply=bodies[1].messages.find(m=>m.role==='tool');
  assert.equal(reply.tool_call_id,'call1');
  assert.equal(JSON.parse(reply.content).data.blocks[0].content,'Evidence 6');
  assert.equal(bodies[1].messages.find(m=>m.tool_calls)?.tool_calls[0].function.name,'getScene');
  assert.equal(result.content,'Evidence-based answer.');
  assert.ok(chunks.some(c=>c.type==='reset'));assert.deepEqual(root,before);
});
test('read-only loop terminates at the round limit',async t=>{
  const bodies=inspectFetch(t,()=>streamResponse({tool_calls:[{index:0,...toolCall('getScenes',{})}]},'tool_calls'));
  await assert.rejects(new AgentOrchestrator(settings).stream(options,()=>{}),/retrieval limit/);
  assert.equal(bodies.length,MAX_TOOL_ROUNDS+1);
});
test('unknown mutation tool cannot change project and returns incomplete error',()=>{
  const before=structuredClone(root);
  assert.equal(retrieveToolResult('deleteScene',{sceneId:'s0'},root,episode).complete,false);
  const result=retrieveToolResult('getScene',{sceneId:'s0'},root,episode);
  result.data.blocks[0].content='MUTATED';
  assert.deepEqual(root,before);
});
test('partial context and truncated results carry explicit incompleteness',()=>{
  const context=buildAgentContext(options);
  assert.equal(context.retrieval.complete,false);
  assert.match(context.systemPromptAddendum,/PARTIAL/);
  assert.equal(retrieveToolResult('getScenes',{limit:2},root,episode).complete,false);
  assert.match(CO_WRITER_SYSTEM_INSTRUCTION,/Never claim a list is complete unless/);
});
test('Isha title does not establish nickname/identity; exact name retrieval only',()=>{
  const context=buildAgentContext(options);
  assert.ok(!/nickname|same person/.test(context.formattedContext));
  assert.ok(!initialReadOnlyQueries('Where does Isha appear?',episode).some(c=>c.name==='getCharacter'));
  assert.match(CO_WRITER_SYSTEM_INSTRUCTION,/do NOT establish that Isha is Sirisha's nickname/);
});
test('DAY/PRE-DAWN labels remain labels, not deterministic elapsed time',()=>{
  const context=buildAgentContext(options);
  assert.match(context.formattedContext,/DAY/);assert.match(context.formattedContext,/PRE-DAWN/);
  assert.ok(!/many hours|a full day|the next morning/.test(context.formattedContext));
  assert.match(CO_WRITER_SYSTEM_INSTRUCTION,/not exact elapsed time/);
});

for (const Provider of [SarvamProvider,OpenAICompatibleProvider]) {
  test(`${Provider.name} serializes tools and parses nonstreamed tool requests`,async t=>{
    const bodies=inspectFetch(t,()=>Response.json({choices:[{message:{content:null,tool_calls:[toolCall('getScene',{sceneId:'s1'})]},finish_reason:'tool_calls'}]}));
    const provider=new Provider('test');
    const response=await provider.generate({messages:[{role:'assistant',content:'',toolCalls:[{id:'prev',name:'getScenes',arguments:{}}]},{role:'tool',toolCallId:'prev',content:'{}'}],tools:[{name:'getScene',description:'Read scene',parameters:{type:'object',properties:{}}}]},'test-model');
    assert.equal(bodies[0].tools[0].function.name,'getScene');assert.equal(bodies[0].messages[1].tool_call_id,'prev');
    assert.equal(response.toolCalls[0].arguments.sceneId,'s1');
  });
  test(`${Provider.name} assembles tool deltas across network fragments and keeps usage`,async t=>{
    const events=[{choices:[{delta:{tool_calls:[{index:0,id:'c1',function:{name:'getScene',arguments:'{"scene'}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:'Id":"s4"}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5}}];
    const data=events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+'data: [DONE]';
    t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<data.length;i+=7)controller.enqueue(new TextEncoder().encode(data.slice(i,i+7)));controller.close();}})));
    const result=await new Provider('test').stream({messages:[]},'test-model',()=>{});
    assert.equal(result.toolCalls[0].arguments.sceneId,'s4');assert.equal(result.usage.inputTokens,10);
  });
}
test('safe Markdown supports requested prose formatting',()=>{
  const html=renderToStaticMarkup(createElement(SafeMarkdown,{content:'# Heading\n\nA **bold** and *italic* `code`.\n\n- One\n- Two\n\n1. First\n2. Second\n\n> Quote'}));
  for(const tag of ['h3','p','strong','em','code','ul','ol','li','blockquote']) assert.ok(html.includes('<'+tag));
});
test('unsafe HTML and executable links are rendered as inert text',()=>{
  const html=renderToStaticMarkup(createElement(SafeMarkdown,{content:'<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[click](javascript:alert(3))\n\n<iframe srcdoc="evil">'}));
  assert.ok(!/<script|<img|<iframe|<a\s/.test(html));assert.ok(html.includes('&lt;script&gt;'));
});

test('cancellation prevents further retrieval/provider rounds',async t=>{
  const controller=new AbortController();
  const bodies=inspectFetch(t,()=>{controller.abort();return streamResponse({tool_calls:[{index:0,...toolCall('getScenes',{})}]},'tool_calls');});
  await assert.rejects(new AgentOrchestrator(settings).stream({...options,abortSignal:controller.signal},()=>{}),/cancelled/);
  assert.equal(bodies.length,1);
});
test('development diagnostics expose scoped IDs/tools/routing but never API keys or raw provider errors',async t=>{
  const original=process.env.NODE_ENV;process.env.NODE_ENV='development';
  t.after(()=>{if(original===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=original;});
  const logs=[];t.mock.method(console,'debug',(...args)=>logs.push(args));
  inspectFetch(t,(_p,n)=>n===1?new Response('PRIVATE_PROVIDER_ERROR',{status:503}):streamResponse({content:'Done'}));
  const fallbackSettings={...settings,routing:{...settings.routing,fallbacks:[{providerId:'sarvam',model:'sarvam-30b'}]}};
  await new AgentOrchestrator(fallbackSettings).stream({...options,userQuery:'List every scene'},()=>{});
  const text=JSON.stringify(logs);
  for(const expected of ['ep','s0','s1','getScenes','entityIds','sarvam-30b','capacity'])assert.ok(text.includes(expected), expected + ": " + text);
  assert.ok(!text.includes('test-only'));assert.ok(!text.includes('PRIVATE_PROVIDER_ERROR'));
});
test('production requests do not emit debugging information',async t=>{
  const original=process.env.NODE_ENV;process.env.NODE_ENV='production';
  t.after(()=>{if(original===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=original;});
  const logs=[];t.mock.method(console,'debug',(...args)=>logs.push(args));
  inspectFetch(t,()=>streamResponse({content:'Done'}));
  await new AgentOrchestrator(settings).stream(options,()=>{});
  assert.equal(logs.length,0);
});
