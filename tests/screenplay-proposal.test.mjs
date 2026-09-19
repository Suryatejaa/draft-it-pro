import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { alternativeToProposal, createScreenplayAlternatives, inspectAlternativeResponse, inspectProposalResponse, parseProposalBlocks, createScreenplayProposal, validateProposal, isCoDrafterEditableBlock } from '../lib/ai/screenplay-proposal.ts';
import { resolveCoDrafterEditableBlocks } from '../lib/ai/co-drafter-selection.ts';
import { getCompatibleCoDrafterActions, getCoDrafterLaunchStep, shouldConsumeInitialAction } from '../lib/ai/co-drafter-actions.ts';
import { appliedToSceneMessage, buildProposalProviderInstruction, buildProposalRepairInstruction, classifyAlternativeProviderOutput, shouldRetryAlternativeProviderOutput, shouldRetryProposalResponse } from '../lib/ai/proposal-request.ts';

const selection = {
  sceneId: 'scene-1',
  selectedBlockIds: ['b2', 'b3'],
  selectedText: 'MAYA\nI never left.',
  blockTypes: ['character', 'dialogue'],
  sourceRevision: 'revision-a',
};

test('Co-Drafter selection keeps only editable blocks and preserves stable IDs', () => {
  const blocks = [
    { id: 'action-a', type: 'action', content: 'Same text.' },
    { id: 'character-a', type: 'character', content: 'SIRISHA' },
    { id: 'dialogue-a', type: 'dialogue', content: 'Okay.' },
    { id: 'action-b', type: 'action', content: 'Same text.' },
  ];
  const resolved = resolveCoDrafterEditableBlocks({ sceneId: 'scene-1', selectedBlockIds: blocks.map((block) => block.id), selectedText: '', blockTypes: blocks.map((block) => block.type), sourceRevision: 'rev' }, blocks);
  assert.deepEqual(resolved.map((block) => block.id), ['action-a', 'dialogue-a', 'action-b']);
  assert.equal(isCoDrafterEditableBlock({ type: 'character' }), false);
  assert.equal(isCoDrafterEditableBlock({ type: 'action' }), true);
});

test('Co-Drafter selection resolves zero, one, and multiple eligible blocks', () => {
  const blocks = [
    { id: 'character-a', type: 'character', content: 'SIRISHA' },
    { id: 'dialogue-a', type: 'dialogue', content: 'Okay.' },
    { id: 'action-a', type: 'action', content: 'She moves.' },
  ];
  const resolve = (ids) => resolveCoDrafterEditableBlocks({ sceneId: 'scene-1', selectedBlockIds: ids, selectedText: '', blockTypes: [], sourceRevision: 'rev' }, blocks);
  assert.deepEqual(resolve(['character-a']).map((block) => block.id), []);
  assert.deepEqual(resolve(['character-a', 'dialogue-a']).map((block) => block.id), ['dialogue-a']);
  assert.deepEqual(resolve(['action-a', 'character-a', 'dialogue-a']).map((block) => block.id), ['dialogue-a', 'action-a']);
});

test('Co-Drafter launch steps and action compatibility are deterministic', () => {
  assert.equal(getCoDrafterLaunchStep(0), 0);
  assert.equal(getCoDrafterLaunchStep(1), 2);
  assert.equal(getCoDrafterLaunchStep(2), 1);
  assert.deepEqual(getCompatibleCoDrafterActions('action').map((action) => action.id), ['alternatives', 'tighten', 'make_visual']);
  assert.deepEqual(getCompatibleCoDrafterActions('dialogue').map((action) => action.id), ['alternatives', 'tighten', 'add_subtext', 'improve_dialogue', 'character_voice']);
  assert.equal(getCompatibleCoDrafterActions('character').length, 0);
});

test('initial action nonce is consumed once across remount checks', () => {
  assert.equal(shouldConsumeInitialAction(null, 101), true);
  assert.equal(shouldConsumeInitialAction(101, 101), false);
  assert.equal(shouldConsumeInitialAction(101, 102), true);
});

describe('screenplay proposal parser', () => {
  test('keeps structured provider instructions out of the human-facing quick action label', () => {
    const displayMessage = 'Improve dialogue';
    const providerInstruction = buildProposalProviderInstruction(displayMessage, 'improve_dialogue');

    assert.equal(displayMessage, 'Improve dialogue');
    assert.equal(displayMessage.includes('Return ONLY valid JSON'), false);
    assert.match(providerInstruction, /^Improve dialogue\./);
    assert.match(providerInstruction, /"operations"/);
    assert.match(providerInstruction, /Return ONLY valid JSON/);
  });

  test('uses the same proposal-only provider instruction for make more visual', () => {
    const providerInstruction = buildProposalProviderInstruction('Make this more visual', 'make_visual');

    assert.match(providerInstruction, /observable images and actions/);
    assert.match(providerInstruction, /Return ONLY valid JSON/);
  });

  test('labels the supplied source block in the hidden provider instruction', () => {
    const providerInstruction = buildProposalProviderInstruction('Improve dialogue', 'improve_dialogue', {
      sceneId: 'scene-1',
      selectedBlockIds: ['dialogue-1', 'dialogue-2'],
      selectedText: 'First.\nSecond.',
      blockTypes: ['dialogue', 'dialogue'],
      sourceRevision: 'revision-a',
    }, [
      { id: 'dialogue-1', type: 'dialogue', content: 'First.' },
      { id: 'dialogue-2', type: 'dialogue', content: 'Second.' },
    ]);

    assert.match(providerInstruction, /"id":"dialogue-1"[\s\S]*"type":"dialogue"[\s\S]*"text":"First\."/);
    assert.doesNotMatch(providerInstruction, /dialogue-2/);
    assert.match(providerInstruction, /exactly one replace operation/);
    assert.match(providerInstruction, /sourceBlockId/);
    assert.match(providerInstruction, /SOURCE_BLOCK/);
  });

  test('builds one compact repair instruction with exact editable IDs', () => {
    const repair = buildProposalRepairInstruction({
      sceneId: 'scene-1', selectedBlockIds: ['dialogue-1'], selectedText: 'Original.', blockTypes: ['dialogue'], sourceRevision: 'revision-a',
    }, [{ id: 'dialogue-1', type: 'dialogue', content: 'Original.' }], true);
    assert.match(repair, /previous replacement failed validation/);
    assert.match(repair, /"sourceBlockId":"EXACT SOURCE BLOCK ID"/);
    assert.match(repair, /dialogue-1/);
    assert.match(repair, /small but genuine wording change/);
  });

  test('repairs contract failures once but does not retry valid or truncated responses', () => {
    const legacy = inspectProposalResponse('{"blocks":[{"type":"dialogue","text":"Legacy"}]}');
    const missingId = inspectProposalResponse('{"operations":[{"operation":"replace","type":"dialogue","text":"Missing ID"}]}');
    const valid = inspectProposalResponse('{"operations":[{"operation":"replace","sourceBlockId":"dialogue-1","type":"dialogue","text":"Changed"}]}');
    const truncated = inspectProposalResponse('');

    assert.equal(shouldRetryProposalResponse(legacy), true);
    assert.equal(shouldRetryProposalResponse(missingId), true);
    assert.equal(shouldRetryProposalResponse(valid), false);
    assert.equal(shouldRetryProposalResponse(truncated, [], false, 'length', ''), false);
    assert.equal(shouldRetryProposalResponse(valid, ['No meaningful change for dialogue-1.'], true), true);
  });

  test('requires exactly 3 Alternatives – 1, 2 and 4 are all rejected; exactly 3 passes', () => {
    const one = inspectAlternativeResponse('{"alternatives":[{"sourceBlockId":"dialogue-1","type":"dialogue","text":"Option one."}]}');
    const two = inspectAlternativeResponse('{"alternatives":[{"sourceBlockId":"dialogue-1","type":"dialogue","text":"Option one."},{"sourceBlockId":"dialogue-1","type":"dialogue","text":"Option two."}]}');
    const three = inspectAlternativeResponse('{"alternatives":[{"sourceBlockId":"dialogue-1","type":"dialogue","text":"One."},{"sourceBlockId":"dialogue-1","type":"dialogue","text":"Two."},{"sourceBlockId":"dialogue-1","type":"dialogue","text":"Three."}]}');
    const four = inspectAlternativeResponse('{"alternatives":[{"sourceBlockId":"dialogue-1","type":"dialogue","text":"1"},{"sourceBlockId":"dialogue-1","type":"dialogue","text":"2"},{"sourceBlockId":"dialogue-1","type":"dialogue","text":"3"},{"sourceBlockId":"dialogue-1","type":"dialogue","text":"4"}]}');
    assert.equal(one.parsed, null, '1 alternative must be rejected');
    assert.match(one.rejectionReason ?? '', /exactly 3/, '1-alternative rejection must mention exactly 3');
    assert.equal(two.parsed, null, '2 alternatives must be rejected');
    assert.match(two.rejectionReason ?? '', /exactly 3/, '2-alternative rejection must mention exactly 3');
    assert.equal(three.parsed?.alternatives.length, 3, 'exactly 3 alternatives must parse successfully');
    assert.deepEqual(three.parsed?.alternatives.map((candidate) => candidate.sourceBlockId), ['dialogue-1', 'dialogue-1', 'dialogue-1']);
    assert.equal(four.parsed, null, '4 alternatives must be rejected');
    assert.match(four.rejectionReason ?? '', /exactly 3/, '4-alternative rejection must mention exactly 3');
  });

  test('accepts action Alternatives and preserves the action semantic type', () => {
    const source = [
      { id: 'action-1', type: 'action', content: 'Sirisha walks toward the washroom.' },
      { id: 'char-1', type: 'character', content: 'SIRISHA' },
    ];
    const alternatives = createScreenplayAlternatives(
      { sceneId: 'scene-1', selectedBlockIds: ['char-1', 'action-1'], selectedText: 'SIRISHA\nSirisha walks toward the washroom.', blockTypes: ['character', 'action'], sourceRevision: 'revision-a' },
      source,
      { alternatives: [
        { sourceBlockId: 'action-1', type: 'action', text: 'Sirisha rises and heads toward the washroom.' },
        { sourceBlockId: 'action-1', type: 'action', text: 'Sirisha gets up, moving quietly toward the washroom.' },
        { sourceBlockId: 'action-1', type: 'action', text: 'She stands and walks toward the washroom.' },
      ] },
    );

    assert.ok(alternatives);
    assert.equal(alternatives.original.id, 'action-1');
    assert.equal(alternatives.original.type, 'action');
    const optionTwo = alternativeToProposal(alternatives, alternatives.candidates[1]);
    assert.deepEqual(optionTwo.operations, [{ operation: 'replace', sourceBlockId: 'action-1', type: 'action', text: 'Sirisha gets up, moving quietly toward the washroom.' }]);
    assert.deepEqual(optionTwo.preservedBlockIds, ['char-1']);
    assert.equal(validateProposal(optionTwo, source, 'revision-a').valid, true);
  });

  test('accepts the exact live-shaped action Alternatives response', () => {
    const source = [{ id: 'action-1', type: 'action', content: 'Sirisha bed meeda nunchi lechi, washroom vaipu nadusthundi.' }];
    const parsed = inspectAlternativeResponse(JSON.stringify({
      alternatives: [
        { sourceBlockId: 'action-1', type: 'action', text: 'Sirisha bed meeda nunchi lechi, deep breath teesukoni washroom vaipu nadusthundi.' },
        { sourceBlockId: 'action-1', type: 'action', text: 'Sirisha bed nunchi lechi, direct ga washroom vaipu nadusthundi.' },
        { sourceBlockId: 'action-1', type: 'action', text: 'Sirisha oka heavy breath release chesi, bed nunchi lechi washroom vaipu nadusthundi.' },
      ],
      reasoning: 'Three alternate action beats.',
    }));
    const alternatives = createScreenplayAlternatives(
      { sceneId: 'scene-1', selectedBlockIds: ['action-1'], selectedText: source[0].content, blockTypes: ['action'], sourceRevision: 'revision-a' },
      source,
      parsed.parsed,
    );
    assert.ok(alternatives);
    assert.deepEqual(alternatives.candidates.map((candidate) => candidate.sourceBlockId), ['action-1', 'action-1', 'action-1']);
  });

  test('rejects invalid Alternatives candidates without creating operations', () => {
    const source = [{ id: 'dialogue-1', type: 'dialogue', content: 'Original.' }, { id: 'char-1', type: 'character', content: 'MAYA' }];
    const sel = { sceneId: 'scene-1', selectedBlockIds: ['char-1', 'dialogue-1'], selectedText: 'MAYA\nOriginal.', blockTypes: ['character', 'dialogue'], sourceRevision: 'revision-a' };
    const threeOpts = (opts) => ({ alternatives: opts });
    // wrong key
    assert.equal(inspectAlternativeResponse('{"blocks":[{"type":"dialogue","text":"Legacy"}]}').parsed, null);
    // exactly 2 now rejected at parser level
    assert.equal(inspectAlternativeResponse('{"alternatives":[{"sourceBlockId":"unknown","type":"dialogue","text":"One."},{"sourceBlockId":"unknown","type":"dialogue","text":"Two."}]}').parsed, null);
    // exactly 4 rejected
    assert.equal(inspectAlternativeResponse('{"alternatives":[{"sourceBlockId":"dialogue-1","type":"dialogue","text":"1"},{"sourceBlockId":"dialogue-1","type":"dialogue","text":"2"},{"sourceBlockId":"dialogue-1","type":"dialogue","text":"3"},{"sourceBlockId":"dialogue-1","type":"dialogue","text":"4"}]}').parsed, null);
    // source validation: unknown id
    assert.equal(createScreenplayAlternatives(sel, source, threeOpts([{ sourceBlockId: 'unknown', type: 'dialogue', text: 'One.' }, { sourceBlockId: 'unknown', type: 'dialogue', text: 'Two.' }, { sourceBlockId: 'unknown', type: 'dialogue', text: 'Three.' }])), null);
    // source validation: wrong type
    assert.equal(createScreenplayAlternatives(sel, source, threeOpts([{ sourceBlockId: 'dialogue-1', type: 'action', text: 'One.' }, { sourceBlockId: 'dialogue-1', type: 'action', text: 'Two.' }, { sourceBlockId: 'dialogue-1', type: 'action', text: 'Three.' }])), null);
    // source validation: first option is no-op
    assert.equal(createScreenplayAlternatives(sel, source, threeOpts([{ sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Original.' }, { sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Changed.' }, { sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Also changed.' }])), null);
    // duplicate replacement texts
    assert.equal(createScreenplayAlternatives(sel, source, threeOpts([{ sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Same text.' }, { sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Same text.' }, { sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Same text.' }])), null);
    // each alternative must have exactly ONE operation – more ops rejected
    assert.equal(createScreenplayAlternatives(sel, source, { alternatives: [
      { operations: [{ operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'A.' }, { operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'B.' }] },
      { operations: [{ operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'C.' }] },
      { operations: [{ operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'D.' }] },
    ] }), null, 'first alternative has 2 operations – must be rejected');
  });

  test('choosing Alternative option 2 creates exactly one normal replace operation', () => {
    const source = [{ id: 'dialogue-1', type: 'dialogue', content: 'Original.' }, { id: 'char-1', type: 'character', content: 'MAYA' }];
    const alternatives = createScreenplayAlternatives(
      { sceneId: 'scene-1', selectedBlockIds: ['char-1', 'dialogue-1'], selectedText: 'MAYA\nOriginal.', blockTypes: ['character', 'dialogue'], sourceRevision: 'revision-a' },
      source,
      { alternatives: [
        { sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Option one.' },
        { sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Option two.' },
        { sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Option three.' },
      ] },
    );
    assert.ok(alternatives);
    const proposal = alternativeToProposal(alternatives, alternatives.candidates[1]);
    assert.deepEqual(proposal.operations, [{ operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Option two.' }]);
    assert.deepEqual(proposal.preservedBlockIds, ['char-1']);
    assert.equal(validateProposal(proposal, source, 'revision-a').valid, true);
    assert.equal(validateProposal(proposal, source, 'revision-b').valid, false);
  });

  test('Alternatives initial instruction contains EXACTLY 3 and schema contract', () => {
    const instruction = buildProposalProviderInstruction('Suggest alternatives', 'alternatives', {
      sceneId: 'scene-1', selectedBlockIds: ['char-1', 'dialogue-1'], selectedText: 'MAYA\nOriginal.', blockTypes: ['character', 'dialogue'], sourceRevision: 'revision-a',
    }, [{ id: 'char-1', type: 'character', content: 'MAYA' }, { id: 'dialogue-1', type: 'dialogue', content: 'Original.' }]);
    // Must say EXACTLY 3
    assert.match(instruction, /EXACTLY 3/i);
    // Must include the IMPORTANT block
    assert.match(instruction, /IMPORTANT/);
    assert.match(instruction, /Do not return 1 alternative/);
    assert.match(instruction, /Do not return 2 alternatives/);
    assert.match(instruction, /Each alternative contains exactly ONE replace operation/);
    // Must include the schema shape placeholders
    assert.match(instruction, /"alternatives"/);
    assert.match(instruction, /"operation": "replace"/);
    assert.match(instruction, /"sourceBlockId"/);
    // Editable source block included; structural (char-1) excluded
    assert.match(instruction, /dialogue-1/);
    assert.doesNotMatch(instruction, /EDITABLE_SOURCE_BLOCKS:[\s\S]*char-1/);
    // Language guardrail
    assert.match(instruction, /romanized Telugu\/Tenglish/i);

    const actionInstruction = buildProposalProviderInstruction('Suggest alternatives', 'alternatives', {
      sceneId: 'scene-1', selectedBlockIds: ['action-1'], selectedText: 'Original action.', blockTypes: ['action'], sourceRevision: 'revision-a',
    }, [{ id: 'action-1', type: 'action', content: 'Original action.' }]);
    assert.match(actionInstruction, /EXACTLY 3/i);
    assert.match(actionInstruction, /"id":"action-1"/);
    assert.match(actionInstruction, /"type":"action"/);
    assert.match(actionInstruction, /"sourceBlockId"/);
  });

  test('formats confirmations only after an explicit action with a human-facing scene identity', () => {
    const project = {
      scenes: [{ id: 'scene-1', blocks: [{ type: 'scene_heading', content: 'INT. INTERVIEW ROOM - DAY' }] }],
    };

    assert.equal(appliedToSceneMessage(project, 'scene-1'), 'Applied to Scene 1 · INT. INTERVIEW ROOM - DAY.');
    assert.equal(appliedToSceneMessage(project, 'missing'), 'Applied to screenplay.');
  });

  test('preserves validated semantic screenplay block types', () => {
    const parsed = parseProposalBlocks('{"operations":[{"operation":"replace","sourceBlockId":"b3","type":"dialogue","text":"I never left."}],"reasoning":"More direct."}');
    assert.deepEqual(parsed?.blocks, [
      { type: 'dialogue', content: 'I never left.' },
    ]);
    const proposal = createScreenplayProposal(selection, 'improve_dialogue', [], parsed);
    assert.deepEqual(proposal.sourceBlockIds, []);
    assert.equal(proposal.sourceRevision, 'revision-a');
    assert.equal(proposal.noOp, true);
    assert.equal(proposal.proposalError, "Co-Drafter didn't produce a meaningful change.");
  });

  test('targets only the dialogue block for improve dialogue and preserves surrounding action blocks', () => {
    const blocks = [
      { id: 'char-1', type: 'character', content: 'INTERVIEWER' },
      { id: 'dialogue-1', type: 'dialogue', content: 'Sirisha... introduce yourself' },
      { id: 'action-1', type: 'action', content: 'Sirisha navvuthundi.' },
      { id: 'action-2', type: 'action', content: 'Cheppadaniki ready avuthundi.' },
      { id: 'action-3', type: 'action', content: 'Direct ga interviewer ni kaakunda... direct camera vaipu chusthundi.' },
    ];
    const selectionForDialogue = {
      sceneId: 'scene-1',
      selectedBlockIds: blocks.map((block) => block.id),
      selectedText: 'INTERVIEWER\nSirisha... introduce yourself\nSirisha navvuthundi.\nCheppadaniki ready avuthundi.\nDirect ga interviewer ni kaakunda... direct camera vaipu chusthundi.',
      blockTypes: ['character', 'dialogue', 'action', 'action', 'action'],
      sourceRevision: 'revision-a',
    };
    const proposal = createScreenplayProposal(selectionForDialogue, 'improve_dialogue', blocks, {
      blocks: [{ type: 'dialogue', content: 'Sirisha... tell us about yourself.' }],
      operations: [{ operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Sirisha... tell us about yourself.' }],
      reasoning: 'Makes the intro more direct.',
    });

    assert.deepEqual(proposal.sourceBlockIds, ['dialogue-1']);
    assert.deepEqual(proposal.preservedBlockIds, ['char-1', 'action-1', 'action-2', 'action-3']);
    assert.equal(proposal.noOp, false);
    assert.deepEqual(proposal.original.map((block) => block.id), ['dialogue-1']);
    assert.deepEqual(proposal.suggested.map((block) => block.type), ['dialogue']);
    assert.deepEqual(proposal.operations, [{ operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Sirisha... tell us about yourself.' }]);
  });

  test('focuses action-only rewrites for make more visual and preserves dialogue/character blocks', () => {
    const blocks = [
      { id: 'char-1', type: 'character', content: 'INTERVIEWER' },
      { id: 'dialogue-1', type: 'dialogue', content: 'Sirisha... introduce yourself' },
      { id: 'action-1', type: 'action', content: 'Sirisha navvuthundi.' },
      { id: 'action-2', type: 'action', content: 'Cheppadaniki ready avuthundi.' },
      { id: 'action-3', type: 'action', content: 'Direct ga interviewer ni kaakunda... direct camera vaipu chusthundi.' },
    ];
    const proposal = createScreenplayProposal(
      {
        sceneId: 'scene-1',
        selectedBlockIds: blocks.map((block) => block.id),
        selectedText: 'INTERVIEWER\nSirisha... introduce yourself\nSirisha navvuthundi.\nCheppadaniki ready avuthundi.\nDirect ga interviewer ni kaakunda... direct camera vaipu chusthundi.',
        blockTypes: ['character', 'dialogue', 'action', 'action', 'action'],
        sourceRevision: 'revision-a',
      },
      'make_visual',
      blocks,
      {
        blocks: [
          { type: 'action', content: 'Sirisha looks toward the lens, breath held.' },
          { type: 'action', content: 'Her readiness sharpens against the interviewer’s stare.' },
          { type: 'action', content: 'The camera tracks her silence, drawing the room inward.' },
        ],
        operations: [
          { operation: 'replace', sourceBlockId: 'action-1', type: 'action', text: 'Sirisha looks toward the lens, breath held.' },
          { operation: 'replace', sourceBlockId: 'action-2', type: 'action', text: 'Her readiness sharpens against the interviewer’s stare.' },
          { operation: 'replace', sourceBlockId: 'action-3', type: 'action', text: 'The camera tracks her silence, drawing the room inward.' },
        ],
        reasoning: 'Make the moment more cinematic.',
      },
    );

    assert.deepEqual(proposal.sourceBlockIds, ['action-1', 'action-2', 'action-3']);
    assert.deepEqual(proposal.preservedBlockIds, ['char-1', 'dialogue-1']);
    assert.equal(proposal.noOp, false);
  });

  test('treats identical suggested replacements as no-op proposals', () => {
    const blocks = [{ id: 'dialogue-1', type: 'dialogue', content: 'Sirisha... introduce yourself' }];
    const proposal = createScreenplayProposal(
      { sceneId: 'scene-1', selectedBlockIds: ['dialogue-1'], selectedText: 'Sirisha... introduce yourself', blockTypes: ['dialogue'], sourceRevision: 'revision-a' },
      'improve_dialogue',
      blocks,
      { blocks: [{ type: 'dialogue', content: 'Sirisha... introduce yourself' }], operations: [{ operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Sirisha... introduce yourself' }], reasoning: 'No actual change.' },
    );

    assert.equal(proposal.noOp, true);
    assert.equal(proposal.proposalError, 'Co-Drafter didn\'t produce a meaningful change.');
  });

  test('rejects one dialogue source mapped to five replacement blocks', () => {
    const source = [{ id: 'dialogue-1', type: 'dialogue', content: 'Marriage delay cheyadaniki MCA chesa. Adhi ayyaka Job kosam 2 years back Hyd vacha. 2 years lo 3 jobs change ayya. This phase of life taught me something: life chala simple, but first life kadha teliyaka maname complicate chesukuntam. entha ante..' }];
    const proposal = createScreenplayProposal(
      { sceneId: 'scene-1', selectedBlockIds: ['dialogue-1'], selectedText: source[0].content, blockTypes: ['dialogue'], sourceRevision: 'revision-a' },
      'improve_dialogue',
      source,
      { blocks: [
        { type: 'dialogue', content: 'Marriage delay cheyadaniki MCA chesa.' },
        { type: 'dialogue', content: 'Adhi ayyaka Job kosam 2 years back Hyd vacha.' },
        { type: 'dialogue', content: '2 years lo 3 jobs change ayya.' },
        { type: 'dialogue', content: 'This phase of life taught me something...' },
        { type: 'dialogue', content: 'entha ante..' },
      ] },
    );

    assert.equal(proposal.operations.length, 0);
    assert.equal(proposal.proposalError, 'Co-Drafter returned an invalid block structure. Try again.');
    assert.equal(validateProposal(proposal, source, 'revision-a').valid, false);
  });

  test('replaces one dialogue source with one complete rewritten paragraph', () => {
    const source = [{ id: 'dialogue-1', type: 'dialogue', content: 'The original paragraph.' }];
    const rewritten = 'Marriage delay cheyadaniki MCA chesa. Adhi ayyaka Job kosam 2 years back Hyd vacha. 2 years lo 3 jobs change ayya. This phase of life taught me something: life chala simple, but first life kadha teliyaka maname complicate chesukuntam. entha ante..';
    const proposal = createScreenplayProposal(
      { sceneId: 'scene-1', selectedBlockIds: ['dialogue-1'], selectedText: source[0].content, blockTypes: ['dialogue'], sourceRevision: 'revision-a' },
      'improve_dialogue',
      source,
      { blocks: [{ type: 'dialogue', content: rewritten }], operations: [{ operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: rewritten }] },
    );

    assert.equal(proposal.operations.length, 1);
    assert.equal(proposal.operations[0].sourceBlockId, 'dialogue-1');
    assert.equal(proposal.operations[0].text, rewritten);
    assert.equal(validateProposal(proposal, source, 'revision-a').valid, true);
  });

  test('maps two dialogue replacements by explicit sourceBlockId', () => {
    const source = [
      { id: 'dialogue-A', type: 'dialogue', content: 'First original.' },
      { id: 'dialogue-B', type: 'dialogue', content: 'Second original.' },
    ];
    const proposal = createScreenplayProposal(
      { sceneId: 'scene-1', selectedBlockIds: ['dialogue-A', 'dialogue-B'], selectedText: 'First original.\nSecond original.', blockTypes: ['dialogue', 'dialogue'], sourceRevision: 'revision-a' },
      'improve_dialogue',
      source,
      { blocks: [{ type: 'dialogue', content: 'First revised.' }, { type: 'dialogue', content: 'Second revised.' }], operations: [
        { operation: 'replace', sourceBlockId: 'dialogue-B', type: 'dialogue', text: 'Second revised.' },
        { operation: 'replace', sourceBlockId: 'dialogue-A', type: 'dialogue', text: 'First revised.' },
      ] },
    );

    assert.deepEqual(proposal.operations.map((operation) => operation.sourceBlockId), ['dialogue-B', 'dialogue-A']);
    assert.equal(validateProposal(proposal, source, 'revision-a').valid, true);
  });

  test('rejects malformed or unsafe structured model output', () => {
    assert.equal(parseProposalBlocks('Here is a suggestion'), null);
    assert.equal(parseProposalBlocks('```json\n{"operations":[{"operation":"replace","sourceBlockId":"dialogue-1","type":"unknown","text":"No"}]}\n```'), null);
    assert.equal(parseProposalBlocks('{"operations":[{"operation":"replace","sourceBlockId":"dialogue-1","type":"dialogue","text":""}]}'), null);
    const incidental = parseProposalBlocks('Incidental text before {"operations":[{"operation":"replace","sourceBlockId":"dialogue-1","type":"dialogue","text":"Yes"}]} trailing text');
    assert.ok(incidental);
    assert.deepEqual(incidental?.blocks, [{ type: 'dialogue', content: 'Yes' }]);
    assert.equal(parseProposalBlocks('{"blocks":[{"type":"dialogue","text":"Legacy"}]}'), null);
  });

  test('classifies an empty truncated provider response before proposal validation', () => {
    const inspection = inspectProposalResponse('');

    assert.equal(inspection.jsonCandidate, null);
    assert.equal(inspection.jsonParseSuccess, false);
    assert.equal(inspection.schemaValidationSuccess, false);
    assert.equal(inspection.semanticValidationSuccess, false);
    assert.equal(inspection.rejectionStage, 'json_candidate');
    assert.match(inspection.rejectionReason ?? '', /operations/);
  });

  test('validates stale source revision and rejects applyable proposals outside the current hash', () => {
    const blocks = [{ id: 'dialogue-1', type: 'dialogue', content: 'Sirisha... introduce yourself' }];
    const proposal = createScreenplayProposal(
      { sceneId: 'scene-1', selectedBlockIds: ['dialogue-1'], selectedText: 'Sirisha... introduce yourself', blockTypes: ['dialogue'], sourceRevision: 'revision-a' },
      'improve_dialogue',
      blocks,
      { blocks: [{ type: 'dialogue', content: 'Sirisha... tell us about yourself.' }], operations: [{ operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'Sirisha... tell us about yourself.' }], reasoning: 'Better intro.' },
    );

    assert.equal(validateProposal(proposal, blocks, 'revision-b').valid, false);
    assert.equal(validateProposal(proposal, blocks, 'revision-a').valid, true);
  });

  test('rejects Alternatives for multiple action blocks', () => {
    const source = [
      { id: 'action-1', type: 'action', content: 'She rises.' },
      { id: 'action-2', type: 'action', content: 'She faces the mirror.' },
      { id: 'action-3', type: 'action', content: 'She opens the laptop.' },
      { id: 'char-1', type: 'character', content: 'SIRISHA' },
    ];
    const makeOption = (suffix) => ({ operations: [{ operation: 'replace', sourceBlockId: 'action-1', type: 'action', text: `She rises ${suffix}.` }] });
    const alternatives = createScreenplayAlternatives(
      { sceneId: 'scene-1', selectedBlockIds: ['char-1', 'action-1', 'action-2', 'action-3'], selectedText: '', blockTypes: ['character', 'action', 'action', 'action'], sourceRevision: 'revision-a' },
      source,
      { alternatives: [makeOption('quietly'), makeOption('quickly'), makeOption('hesitantly')] },
    );
    assert.equal(alternatives, null);
  });

  test('rejects Alternatives for mixed editable blocks', () => {
    const source = [
      { id: 'char-1', type: 'character', content: 'SIRISHA' },
      { id: 'dialogue-1', type: 'dialogue', content: 'I am ready.' },
      { id: 'action-1', type: 'action', content: 'She looks away.' },
    ];
    const alternatives = createScreenplayAlternatives(
      { sceneId: 'scene-1', selectedBlockIds: ['char-1', 'dialogue-1', 'action-1'], selectedText: '', blockTypes: ['character', 'dialogue', 'action'], sourceRevision: 'revision-a' },
      source,
      { alternatives: [
        { operations: [
          { operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'I am ready now.' },
          { operation: 'replace', sourceBlockId: 'action-1', type: 'action', text: 'She turns toward the door.' },
        ] },
        { operations: [
          { operation: 'replace', sourceBlockId: 'dialogue-1', type: 'dialogue', text: 'I can do this.' },
          { operation: 'replace', sourceBlockId: 'action-1', type: 'action', text: 'She steadies herself.' },
        ] },
      ] },
    );
    assert.equal(alternatives, null);
  });

  test('rejects Alternatives when multiple editable sources are supplied', () => {
    const source = [{ id: 'action-1', type: 'action', content: 'One.' }, { id: 'action-2', type: 'action', content: 'Two.' }];
    const selectionForAlternatives = { sceneId: 'scene-1', selectedBlockIds: ['action-1', 'action-2'], selectedText: '', blockTypes: ['action', 'action'], sourceRevision: 'revision-a' };
    assert.equal(createScreenplayAlternatives(selectionForAlternatives, source, { alternatives: [{ operations: [{ operation: 'replace', sourceBlockId: 'action-1', type: 'action', text: 'Changed one.' }] }, { operations: [{ operation: 'replace', sourceBlockId: 'action-2', type: 'action', text: 'Changed two.' }] }] }), null);
  });

  test('classifies Sarvam reasoning-only output as truncation and retries exactly once', () => {
    const failure = classifyAlternativeProviderOutput('', 'large reasoning', 'length', 4096, 4097);
    assert.equal(failure?.rejectionStage, 'provider_output');
    assert.equal(failure?.rejectionCode, 'SARVAM_OUTPUT_TRUNCATED');
    assert.equal(failure?.completionTokens, 4097);
    assert.equal(shouldRetryAlternativeProviderOutput('', 'large reasoning', 'length', 0), true);
    assert.equal(shouldRetryAlternativeProviderOutput('', 'large reasoning', 'length', 1), false);
  });

  test('classifies empty content twice without permitting a second retry', () => {
    const first = classifyAlternativeProviderOutput('', 'reasoning', 'stop', 4096, 100);
    const second = classifyAlternativeProviderOutput('', 'reasoning', 'length', 4096, 4097);
    assert.equal(first?.rejectionCode, 'SARVAM_EMPTY_FINAL_CONTENT');
    assert.equal(second?.rejectionCode, 'SARVAM_OUTPUT_TRUNCATED');
    assert.equal(shouldRetryAlternativeProviderOutput('', 'reasoning', 'stop', 1), false);
  });

  test('keeps valid content parseable even when reasoning content is large', () => {
    const content = '{"alternatives":[]}';
    assert.equal(classifyAlternativeProviderOutput(content, 'large reasoning', 'stop', 4096), null);
    assert.equal(shouldRetryAlternativeProviderOutput(content, 'large reasoning', 'stop', 0), false);
  });

  test('classifies partial length output as provider truncation', () => {
    const failure = classifyAlternativeProviderOutput('{"alternatives":[', 'reasoning', 'length', 4096, 4097);
    assert.equal(failure?.rejectionStage, 'provider_output');
    assert.equal(failure?.rejectionCode, 'SARVAM_OUTPUT_TRUNCATED');
  });

  test('does not retry cancellation, auth, or network-shaped empty responses', () => {
    assert.equal(shouldRetryAlternativeProviderOutput('', '', 'cancelled', 0), false);
    assert.equal(shouldRetryAlternativeProviderOutput('', '', 'error', 0), false);
    assert.equal(shouldRetryAlternativeProviderOutput('', '', undefined, 0), false);
  });
});
