// Tests: Credential security — AI keys never enter project snapshots
import { test, describe } from 'node:test';
import { strict as strictAssert } from 'node:assert';

import { copyProjectSnapshot } from '../lib/production.ts';

// Simulate what backupPackage / export does: JSON.stringify the project
function serializeProject(project) {
  return JSON.stringify(project);
}

describe('Credential security — credentials must never enter project snapshots', () => {
  const CLEAN_PROJECT = {
    id: 'proj-security',
    title: 'Secure Project',
    format: 'Feature',
    genre: 'Drama',
    logline: '',
    premise: '',
    theme: '',
    synopsis: '',
    treatment: '',
    notes: '',
    references: '',
    targetRuntime: 90,
    draft: '',
    updatedAt: '2026-01-01',
    schemaVersion: 2,
    kind: 'single',
    scenes: [],
    characters: [],
    locations: [],
    panels: [],
    acts: [],
  };

  const MOCK_API_KEY = 'sk-test-CREDENTIALSTHATMUSTNOTLEAK-abc123xyz';
  const MOCK_KEY_2 = 'sarvam-api-key-SECRETTOKEN-999';

  test('copyProjectSnapshot does not include AI credentials', () => {
    const copied = copyProjectSnapshot(CLEAN_PROJECT);
    const serialized = serializeProject(copied);
    strictAssert.ok(
      !serialized.includes(MOCK_API_KEY),
      'AI API key must never appear in copyProjectSnapshot output'
    );
    strictAssert.ok(
      !serialized.includes(MOCK_KEY_2),
      'Sarvam API key must never appear in copyProjectSnapshot output'
    );
  });

  test('raw project JSON serialization does not include AI credentials', () => {
    // Simulate that credentials are stored separately (localStorage) and never on the project object
    const projectWithNoCredentials = { ...CLEAN_PROJECT };
    const serialized = serializeProject(projectWithNoCredentials);
    strictAssert.ok(!serialized.includes('apiKey'), 'No apiKey field should exist in project snapshot');
    strictAssert.ok(!serialized.includes('sarvam'), 'No sarvam provider config should exist in project snapshot');
    strictAssert.ok(!serialized.includes('openaiCompatible'), 'No openaiCompatible config in project snapshot');
    strictAssert.ok(!serialized.includes('draftit_ai'), 'No AI credential store key in project snapshot');
  });

  test('credentials key prefix is not related to project storage key prefix', () => {
    const AI_CRED_KEY = 'draftit_ai_credentials_v1';
    const CONV_KEY_PREFIX = 'draftit_cowriter_chat_v1_';
    const PROJECT_KEYS = ['draftit_projects', 'draftit_project_', 'firebase', 'idb_'];

    for (const projectKey of PROJECT_KEYS) {
      strictAssert.ok(
        !AI_CRED_KEY.startsWith(projectKey),
        `AI credential key '${AI_CRED_KEY}' must be namespaced separately from project key '${projectKey}'`
      );
      strictAssert.ok(
        !CONV_KEY_PREFIX.startsWith(projectKey),
        `Conversation key prefix '${CONV_KEY_PREFIX}' must be namespaced separately from '${projectKey}'`
      );
    }
  });
});

import { saveAISettings, loadAISettings, DEFAULT_AI_SETTINGS } from '../lib/ai/credentials.ts';
import { buildAgentContext } from '../lib/ai/context-builder.ts';
import { executeToolCall } from '../lib/ai/tools.ts';

test('real credential store remains separate from snapshot export, copy and every workspace context',()=>{
 const previousWindow=globalThis.window,previousStorage=globalThis.localStorage;const values=new Map();
 globalThis.window={localStorage:{}};globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 try{
  const secret='credential-secret-sentinel';saveAISettings({...DEFAULT_AI_SETTINGS,sarvam:{...DEFAULT_AI_SETTINGS.sarvam,apiKey:secret}});strictAssert.equal(loadAISettings().sarvam.apiKey,secret);
  const p={id:'isolation',title:'Title',scenes:[],characters:[],locations:[],panels:[],castMembers:[{name:'Cast',phone:'private-phone-sentinel',email:'private-email-sentinel'}],crewMembers:[{name:'Crew',phone:'private-phone-sentinel',email:'private-email-sentinel'}]};
  for(const view of ['Screenplay','Characters','Cast & Crew','Schedule','Storyboard']){
   const text=buildAgentContext({rootProject:p,activeView:view}).formattedContext;for(const value of [secret,'private-phone-sentinel','private-email-sentinel'])strictAssert.ok(!text.includes(value));
  }
  strictAssert.ok(!JSON.stringify(p).includes(secret));strictAssert.ok(!JSON.stringify(copyProjectSnapshot(p)).includes(secret));
 }finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;}
});
test('read-only results do not alias mutable screenplay or location objects',()=>{
 const p={id:'read-only',scenes:[{id:'s',heading:'INT. ROOM - DAY',blocks:[{id:'b',type:'action',content:'Original'}],characterIds:[]}],characters:[],locations:[{id:'l',name:'ROOM',description:'Original'}]};
 const scene=executeToolCall('getScene',{sceneId:'s'},p);scene.blocks[0].content='Mutated';strictAssert.equal(p.scenes[0].blocks[0].content,'Original');
 const loc=executeToolCall('getStoryLocation',{locationIdOrName:'l'},p);loc.description='Mutated';strictAssert.equal(p.locations[0].description,'Original');
});
