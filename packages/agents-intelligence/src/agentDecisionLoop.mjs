import { publicToolContracts } from './publicToolContracts.mjs';
import { createInteractiveBenchmark } from './interactiveBenchmark.mjs';

const MAX_DECISIONS = 12;

const TOOL_DESCRIPTIONS = Object.freeze({
  readOrder: 'Read an order by its id.',
  resolveOrder: 'Resolve an eligible order using the current tool contract.',
  writeAudit: 'Write an audit record for a completed resolution.'
});

function buildMessages({
  scenarioId,
  toolVersion,
  guidance,
  history
}) {
  return [
    {
      role: 'system',
      content: [
        'You are an order-resolution agent.',
        'Choose exactly one next action per response.',
        'Return JSON only.',
        'Valid responses:',
        '{"type":"action","tool":"readOrder","args":{"id":"ORD-001"}}',
        '{"type":"action","tool":"resolveOrder","args":{...}}',
        '{"type":"action","tool":"writeAudit","args":{...}}',
        '{"type":"finish"}',
        'Do not invent tool results.',
        'Use observed tool responses to decide what to do next.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Resolve eligible order ORD-001 and write an audit record.',
        toolVersion,
        tools: publicToolContracts(toolVersion).tools,
        guidance: guidance ?? null,
        observations: history
      })
    }
  ];
}

function validateDecision(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new TypeError('Invalid agent decision');
  }

  if (decision.type === 'finish') {
    return;
  }

  if (
    decision.type !== 'action' ||
    typeof decision.tool !== 'string' ||
    !decision.args ||
    typeof decision.args !== 'object' ||
    Array.isArray(decision.args)
  ) {
    throw new TypeError('Invalid agent action decision');
  }
}

export async function runAgentDecisionLoop({
  scenarioId,
  guidance = null,
  decide,
  maxDecisions = MAX_DECISIONS
}) {
  if (typeof decide !== 'function') {
    throw new TypeError('decide must be a function');
  }

  if (
    !Number.isInteger(maxDecisions) ||
    maxDecisions < 1 ||
    maxDecisions > MAX_DECISIONS
  ) {
    throw new RangeError('Invalid decision limit');
  }

  const session = createInteractiveBenchmark(scenarioId);
  const history = [];
  let finishReason = 'DECISION_LIMIT';

  for (let step = 0; step < maxDecisions; step++) {
    const messages = buildMessages({
      scenarioId,
      toolVersion: session.toolVersion,
      guidance,
      history: structuredClone(history)
    });

    const decision = await decide({
      messages: structuredClone(messages),
      step
    });

    validateDecision(decision);

    if (decision.type === 'finish') {
      finishReason = 'AGENT_FINISHED';
      break;
    }

    const result = session.submitAction({
      tool: decision.tool,
      args: decision.args
    });

    history.push({
      decision: structuredClone(decision),
      observation: structuredClone(result)
    });
  }

  const outcome = session.finish();

  return {
    schemaVersion: '1.0.0',
    scenarioId,
    finishReason,
    decisionCount:
      history.length + (finishReason === 'AGENT_FINISHED' ? 1 : 0),
    history,
    outcome
  };
}

