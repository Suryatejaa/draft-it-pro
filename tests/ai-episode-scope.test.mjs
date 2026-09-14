import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAllScenesForEpisode, getEpisodeSceneScope, sceneRetrievalCoverage } from '../lib/ai/episode-scenes.ts';
import { executeToolCall, retrieveToolResult, initialReadOnlyQueries } from '../lib/ai/tools.ts';
import { buildAgentContext } from '../lib/ai/context-builder.ts';
import { searchProject } from '../lib/ai/project-search.ts';
import { AgentOrchestrator } from '../lib/ai/orchestrator.ts';

const episode = { id:'episode', title:'Pilot', acts:['Act I','Act II','Act III'], sceneCount:6,
  scenes:Array.from({length:6},(_,i)=>({id:`s${i+1}`,act:i<2?'Act I':i<5?'Act II':'Act III',heading:`INT. ROOM ${i+1} - DAY`,summary:i===0?'Stored Sirisha summary':'',characterIds:i===0||i===4?['sirisha']:i===3?['shiva']:[],blocks:[{id:`b${i}`,type:'action',content:`Sirisha action ${i+1}`},{id:`d${i}`,type:'dialogue',content:`SIRISHA: Dialogue ${i+1}`}] })),
  characters:[{id:'sirisha',name:'Sirisha'},{id:'shiva',name:'Shiva'}],locations:[],panels:[] };
const root={id:'root',title:'Series',kind:'series',scenes:[],characters:[],locations:[],episodes:[episode]};
const actWorkspace={...episode,scenes:episode.scenes.slice(0,2),activeActId:'Act I'};
const sceneIds=['s1','s2','s3','s4','s5','s6'];
const appearanceIds=['s1','s5'];

test('canonical accessor preserves six-scene screenplay order across three acts',()=>{
  assert.deepEqual(getAllScenesForEpisode(root,episode.id).map(s=>s.id),sceneIds);
  assert.deepEqual(getEpisodeSceneScope(root,actWorkspace).scenes.map(s=>s.act),['Act I','Act I','Act II','Act II','Act II','Act III']);
});
test('global getScenes ignores current-act workspace subset',()=>{
  const result=retrieveToolResult('getScenes',{},root,actWorkspace);
  assert.deepEqual(result.data.map(s=>s.id),sceneIds);
  assert.equal(result.complete,true);
  assert.equal(result.episodeCoverage.scannedSceneCount,6);
  assert.equal(result.episodeCoverage.retrievedSceneCount,6);
  assert.deepEqual(result.data.map(s=>s.sceneNumber),[1,2,3,4,5,6]);
  assert.equal(result.episodeCoverage.matchedSceneCount,6);
  assert.deepEqual(result.data[0].characterNames,['Sirisha']);
  assert.equal(result.data[0].summary,'Stored Sirisha summary');
  assert.equal(result.data[0].screenplayExcerpt,undefined);
  assert.equal(result.data[1].summary,undefined);
  assert.match(result.data[1].screenplayExcerpt,/^Screenplay excerpt: \[action\]/);
  assert.equal(result.data[1].summarySource,'screenplay_excerpt');
});
test('local context remains current and neighboring scenes, across an act boundary when appropriate',()=>{
  const context=buildAgentContext({rootProject:root,activeWorkspace:actWorkspace,currentSceneId:'s2',activeView:'Screenplay',activeActId:'Act I'});
  assert.deepEqual(context.retrieval.includedSceneIds.sort(),['s1','s2','s3']);
  assert.deepEqual(context.retrieval.fullScriptSceneIds,['s2']);
  assert.ok(!context.formattedContext.includes('Sirisha action 6'));
  assert.equal(context.retrieval.complete,false);
});
test('character lookup and appearance filtering scan every act before matching',()=>{
  const character=executeToolCall('getCharacter',{characterIdOrName:'Sirisha'},root,actWorkspace);
  assert.deepEqual(character.sceneIds,appearanceIds);
  const result=retrieveToolResult('getScenes',{characterId:'sirisha'},root,actWorkspace);
  assert.deepEqual(result.data.map(s=>s.id),appearanceIds);
  assert.equal(result.episodeCoverage.scannedSceneCount,6);
  assert.equal(result.episodeCoverage.matchedSceneCount,2);
  assert.equal(result.episodeCoverage.matchedCharacter,'Sirisha');
  assert.deepEqual(result.episodeCoverage.actsScanned,episode.acts);
  assert.equal(result.complete,true);
});
test('global results are unaffected by activeActId, active scene, or visible cards',()=>{
  for(const activeActId of episode.acts){
    const workspace={...actWorkspace,activeActId,currentAct:activeActId,selectedAct:activeActId,visibleScenes:[],filteredScenes:[]};
    assert.deepEqual(executeToolCall('getScenes',{},root,workspace).map(s=>s.id),sceneIds);
  }
});
test('two available scenes out of declared six cannot be labelled complete',()=>{
  const partialRoot={...root,episodes:[actWorkspace]};
  const result=retrieveToolResult('getScenes',{},partialRoot,actWorkspace);
  assert.equal(result.episodeCoverage.episodeSceneCount,6);
  assert.equal(result.episodeCoverage.scannedSceneCount,2);
  assert.equal(result.complete,false);
});
test('two returned out of six and explicit act filtering are not episode-complete',()=>{
  assert.equal(retrieveToolResult('getScenes',{limit:2},root,actWorkspace).complete,false);
  assert.equal(retrieveToolResult('getScenes',{act:'Act I'},root,actWorkspace).complete,false);
  const scope=getEpisodeSceneScope(root,actWorkspace);
  assert.equal(sceneRetrievalCoverage(scope,episode.scenes.slice(0,2),episode.scenes.slice(0,2),episode.scenes.slice(0,2)).complete,false);
  assert.equal(sceneRetrievalCoverage(scope,episode.scenes,episode.scenes,episode.scenes).complete,true);
});
test('missing canonical episode never upgrades a workspace subset to complete',()=>{
  assert.equal(retrieveToolResult('getScenes',{}, {...root,episodes:[]},actWorkspace).complete,false);
});
test('search scans later acts using canonical episode rather than supplied act subset',()=>{
  const results=searchProject(root,'Sirisha',actWorkspace).filter(item=>item.type==='scene');
  assert.equal(results.length,6);
  assert.ok(executeToolCall('searchProject',{query:'action 6'},root,actWorkspace).some(item=>item.id==='s6'));
});
test('episode-wide intent variants trigger full-scene retrieval independent of act',()=>{
  for(const query of ['every scene in this episode','all scenes','across the episode','throughout this episode','where does Sirisha appear?',"analyse Sirisha's arc",'all locations used in this episode','all scenes involving Shiva']){
    const queries=initialReadOnlyQueries(query,root,actWorkspace);
    assert.ok(queries.some(call=>call.name==='getScenes'),query);
    assert.ok(queries.every(call=>!call.arguments.act),query);
  }
});
test('global Sirisha question sends all six scenes despite two character links and logs complete coverage',async t=>{
  const old=process.env.NODE_ENV;process.env.NODE_ENV='development';
  t.after(()=>{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;});
  const logs=[];t.mock.method(console,'debug',(...args)=>logs.push(args));
  let payload;
  t.mock.method(globalThis,'fetch',async(_url,init)=>{payload=JSON.parse(init.body);return new Response('data: {"choices":[{"delta":{"content":"Grounded result"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});
  const settings={sarvam:{apiKey:'test-key',model:'sarvam-105b'},openaiCompatible:{apiKey:'',baseUrl:'',model:''},activeProviderId:'auto',routing:{primaryProviderId:'sarvam',primaryModel:'sarvam-105b',fallbacks:[]}};
  await new AgentOrchestrator(settings).stream({rootProject:root,activeWorkspace:actWorkspace,currentSceneId:'s1',activeActId:'Act I',userQuery:'List every scene in this episode where Sirisha appears and briefly explain what happens in each.'},()=>{});
  const sceneResult=payload.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(r=>r.detail==='scene_summaries_only');
  assert.deepEqual(sceneResult.data.map(s=>s.id),sceneIds);
  assert.equal(sceneResult.complete,true);
  const diagnostics=logs.filter(row=>row[1]==='episode_retrieval').at(-1)[2];
  for(const [key,value] of Object.entries({scope:'episode',episodeId:'episode',activeActId:'Act I',episodeSceneCount:6,retrievedSceneCount:6,matchedCharacter:undefined,matchedSceneCount:6,canonicalSceneCount:6,linkedCharacterMatchCount:2,serializedSceneCount:6,completeEpisodeCoverage:true,complete:true}))assert.equal(diagnostics[key],value,key);
  assert.deepEqual(diagnostics.actsScanned,episode.acts);
});

test('six canonical scenes with only two character links still serialize six compact records to Sarvam',async t=>{
  const sparse={...episode,scenes:episode.scenes.map((scene,i)=>({...scene,summary:i<2?scene.summary:'',characterIds:i<2?['sirisha']:[]}))};
  const sparseRoot={...root,episodes:[sparse]};
  const queries=initialReadOnlyQueries('List every scene in this episode where Sirisha appears and briefly explain what happens in each.',sparseRoot,sparse);
  assert.deepEqual(queries.find(call=>call.name==='getScenes').arguments,{});
  assert.equal(executeToolCall('getScenes',{characterId:'sirisha'},sparseRoot,sparse).length,2,'Reproduces the former pre-filter reduction');
  let payload;
  t.mock.method(globalThis,'fetch',async(_url,init)=>{payload=JSON.parse(init.body);return new Response('data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});
  const settings={sarvam:{apiKey:'test-key',model:'sarvam-105b'},openaiCompatible:{apiKey:'',baseUrl:'',model:''},activeProviderId:'auto',routing:{primaryProviderId:'sarvam',primaryModel:'sarvam-105b',fallbacks:[]}};
  await new AgentOrchestrator(settings).stream({rootProject:sparseRoot,activeWorkspace:sparse,currentSceneId:'s1',userQuery:'List every scene in this episode where Sirisha appears and briefly explain what happens in each.'},()=>{});
  const result=payload.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(r=>r.detail==='scene_summaries_only');
  assert.deepEqual(result.data.map(scene=>scene.id),sceneIds);
  assert.equal(result.returnedCount,6);assert.equal(result.episodeCoverage.returnedSceneCount,6);assert.equal(result.complete,true);
  for(const scene of result.data.slice(2)){assert.equal(scene.summarySource,'screenplay_excerpt');assert.ok(scene.summary.includes('Sirisha action'));assert.ok(scene.summary.length<=600);assert.equal(scene.blocks,undefined);}
});
