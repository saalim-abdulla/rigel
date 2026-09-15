import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPathInside } from '../filesystem-boundary';
import { createHandoff, renderHandoff } from '../handoff';
import { selectModel } from '../model-selector';
import { runTaskPlan } from '../orchestrator';
import {
  findModelPrice,
  ModelCategory,
  ModelPrice,
  normalizeGithubPricing,
  parsePricingCatalog
} from '../pricing-catalog';
import { normalizeError, ProgressSupervisor, stableStringify } from '../progress-supervisor';
import { parseTaskCompletion, parseTaskPlan, taskPrompt } from '../task-plan';
import { workspacePathParts } from '../workspace-path';

interface TestCase {
  name: string;
  run(): void | Promise<void>;
}

const tests: TestCase[] = [];
const test = (name: string, run: TestCase['run']) => tests.push({ name, run });

const model = (id: string, vendor = 'copilot') => ({
  id,
  vendor,
  family: id,
  name: id
});

const price = (
  modelName: string,
  category: ModelCategory,
  input: number,
  output: number
): ModelPrice => ({
  provider: 'test',
  model: modelName,
  category,
  tier: 'Default',
  thresholdOperator: null,
  thresholdTokens: null,
  inputUsdPerMillionTokens: input,
  outputUsdPerMillionTokens: output
});

test('stableStringify ignores object key order', () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));
});

test('supervisor escalates a repeated tool call', () => {
  const supervisor = new ProgressSupervisor({
    maxActions: 10,
    repeatedActionLimit: 3,
    repeatedErrorLimit: 2
  });

  assert.equal(supervisor.observe({ kind: 'tool-call', tool: 'read', input: { path: 'a.ts' } }).action, 'continue');
  assert.equal(supervisor.observe({ kind: 'tool-call', tool: 'read', input: { path: 'a.ts' } }).action, 'continue');
  const decision = supervisor.observe({ kind: 'tool-call', tool: 'read', input: { path: 'a.ts' } });
  assert.equal(decision.action, 'escalate');
  assert.match(decision.reason ?? '', /3 times/);
});

test('supervisor treats reordered arguments as the same action', () => {
  const supervisor = new ProgressSupervisor({
    maxActions: 10,
    repeatedActionLimit: 2,
    repeatedErrorLimit: 2
  });

  supervisor.observe({ kind: 'tool-call', tool: 'search', input: { glob: '**/*.ts', limit: 20 } });
  const decision = supervisor.observe({ kind: 'tool-call', tool: 'search', input: { limit: 20, glob: '**/*.ts' } });
  assert.equal(decision.action, 'escalate');
});

test('workspace changes reset repeated read detection', () => {
  const supervisor = new ProgressSupervisor({
    maxActions: 10,
    repeatedActionLimit: 3,
    repeatedErrorLimit: 2
  });

  supervisor.observe({ kind: 'tool-call', tool: 'read', input: { path: 'a.ts' } });
  supervisor.observe({ kind: 'tool-call', tool: 'read', input: { path: 'a.ts' } });
  supervisor.observe({ kind: 'tool-result', tool: 'write', input: { path: 'a.ts' }, ok: true, summary: 'written', changedWorkspace: true });
  const decision = supervisor.observe({ kind: 'tool-call', tool: 'read', input: { path: 'a.ts' } });
  assert.equal(decision.action, 'continue');
});

test('workspace changes do not hide repeated identical writes', () => {
  const supervisor = new ProgressSupervisor({
    maxActions: 10,
    repeatedActionLimit: 3,
    repeatedErrorLimit: 2
  });
  const call = { kind: 'tool-call' as const, tool: 'write', input: { path: 'a.ts', content: 'x' }, mutatesWorkspace: true };
  supervisor.observe(call);
  supervisor.observe({ kind: 'tool-result', tool: 'write', input: call.input, ok: true, summary: 'written', changedWorkspace: true });
  supervisor.observe(call);
  supervisor.observe({ kind: 'tool-result', tool: 'write', input: call.input, ok: true, summary: 'unchanged', changedWorkspace: false });
  const decision = supervisor.observe(call);
  assert.equal(decision.action, 'escalate');
});

test('supervisor escalates a repeated normalized failure', () => {
  const supervisor = new ProgressSupervisor({
    maxActions: 10,
    repeatedActionLimit: 3,
    repeatedErrorLimit: 2
  });

  supervisor.observe({ kind: 'tool-result', tool: 'test', input: { command: 'npm test' }, ok: false, summary: 'Failed in 125ms at 0x1A' });
  const decision = supervisor.observe({ kind: 'tool-result', tool: 'test', input: { command: 'npm test' }, ok: false, summary: 'Failed in 840ms at 0x2B' });
  assert.equal(decision.action, 'escalate');
});

test('a successful tool result resets that tool failure history', () => {
  const supervisor = new ProgressSupervisor({
    maxActions: 10,
    repeatedActionLimit: 3,
    repeatedErrorLimit: 2
  });

  supervisor.observe({ kind: 'tool-result', tool: 'test', input: { command: 'npm test' }, ok: false, summary: 'suite failed' });
  supervisor.observe({ kind: 'tool-result', tool: 'test', input: { command: 'npm test' }, ok: true, summary: 'suite passed' });
  const decision = supervisor.observe({ kind: 'tool-result', tool: 'test', input: { command: 'npm test' }, ok: false, summary: 'suite failed' });
  assert.equal(decision.action, 'continue');
});

test('an unrelated success does not reset a failed invocation', () => {
  const supervisor = new ProgressSupervisor({
    maxActions: 10,
    repeatedActionLimit: 3,
    repeatedErrorLimit: 2
  });

  supervisor.observe({ kind: 'tool-result', tool: 'command', input: { command: 'npm test' }, ok: false, summary: 'suite failed' });
  supervisor.observe({ kind: 'tool-result', tool: 'command', input: { command: 'pwd' }, ok: true, summary: '/workspace' });
  const decision = supervisor.observe({ kind: 'tool-result', tool: 'command', input: { command: 'npm test' }, ok: false, summary: 'suite failed' });
  assert.equal(decision.action, 'escalate');
});

test('action budget asks the current model to finish instead of escalating', () => {
  const supervisor = new ProgressSupervisor({
    maxActions: 2,
    repeatedActionLimit: 3,
    repeatedErrorLimit: 2
  });

  supervisor.observe({ kind: 'tool-call', tool: 'read', input: { path: 'a.ts' } });
  assert.equal(supervisor.checkpoint().action, 'continue');
  supervisor.observe({ kind: 'tool-call', tool: 'read', input: { path: 'b.ts' } });
  const decision = supervisor.checkpoint();
  assert.equal(decision.action, 'finish');
  assert.match(decision.reason ?? '', /budget/);
});

test('normalization removes volatile numbers and addresses', () => {
  assert.equal(
    normalizeError('Timeout at 0xABC after 12.5s'),
    normalizeError('Timeout at 0xDEF after 44.1s')
  );
});

test('category selection chooses the cheapest available model', () => {
  const selection = selectModel({
    category: 'Versatile',
    available: [model('claude-sonnet'), model('gemini-flash')],
    prices: [
      price('Claude Sonnet', 'Versatile', 2, 10),
      price('Gemini Flash', 'Versatile', 0.75, 3.75)
    ]
  });

  assert.equal(selection.model?.id, 'gemini-flash');
  assert.match(selection.reason, /cheapest available Versatile/);
});

test('a favorite overrides the cheapest model in its category', () => {
  const selection = selectModel({
    category: 'Versatile',
    available: [model('claude-sonnet'), model('gemini-flash')],
    prices: [
      price('Claude Sonnet', 'Versatile', 2, 10),
      price('Gemini Flash', 'Versatile', 0.75, 3.75)
    ],
    favoriteModelId: 'claude-sonnet'
  });

  assert.equal(selection.model?.id, 'claude-sonnet');
  assert.match(selection.reason, /favorite Versatile/);
});

test('a favorite from another category is ignored', () => {
  const selection = selectModel({
    category: 'Powerful',
    available: [model('gpt-5.6-luna'), model('gpt-5.6-sol')],
    prices: [
      price('GPT-5.6 Luna', 'Lightweight', 0.2, 1.2),
      price('GPT-5.6 Sol', 'Powerful', 4, 20)
    ],
    favoriteModelId: 'gpt-5.6-luna'
  });

  assert.equal(selection.model?.id, 'gpt-5.6-sol');
});

test('category selection fails closed when no model matches', () => {
  const selection = selectModel({
    category: 'Powerful',
    available: [model('gpt-5.6-luna')],
    prices: [price('GPT-5.6 Luna', 'Lightweight', 0.2, 1.2)]
  });

  assert.equal(selection.model, undefined);
});

test('bundled catalog selects the cheapest available model in every category', () => {
  const prices = parsePricingCatalog(JSON.parse(readFileSync('resources/copilot-pricing.json', 'utf8')) as unknown);
  const available = [
    model('gpt-5.6-luna'),
    model('gpt-5-mini'),
    model('gemini-3.6-flash'),
    model('claude-sonnet-5'),
    model('gpt-5.3-codex'),
    model('gpt-5.6-sol')
  ];

  assert.equal(selectModel({ category: 'Lightweight', available, prices }).model?.id, 'gpt-5.6-luna');
  assert.equal(selectModel({ category: 'Versatile', available, prices }).model?.id, 'gemini-3.6-flash');
  assert.equal(selectModel({ category: 'Powerful', available, prices }).model?.id, 'gpt-5.3-codex');
});

test('long-context pricing is selected when its threshold applies', () => {
  const prices: ModelPrice[] = [
    { ...price('GPT-5.6 Luna', 'Lightweight', 0.2, 1.2), thresholdOperator: 'lte', thresholdTokens: 200_000 },
    { ...price('GPT-5.6 Luna', 'Lightweight', 0.4, 1.8), tier: 'Long context', thresholdOperator: 'gt', thresholdTokens: 200_000 }
  ];
  assert.equal(findModelPrice(model('gpt-5.6-luna'), prices, 100_000)?.tier, 'Default');
  assert.equal(findModelPrice(model('gpt-5.6-luna'), prices, 250_000)?.tier, 'Long context');
});

test('runtime matcher does not guess from ambiguous or unknown variants', () => {
  const prices = [
    price('GPT-5.6 Luna', 'Lightweight', 0.2, 1.2),
    price('Claude Opus 4.8', 'Powerful', 5, 25)
  ];
  assert.equal(findModelPrice(model('gpt-5'), prices), undefined);
  assert.equal(findModelPrice(model('claude-opus-4.8-fast'), prices), undefined);
});

test('GitHub YAML rows normalize into category pricing', () => {
  const prices = normalizeGithubPricing([{
    provider: 'OpenAI',
    model: 'GPT Test[^note]',
    category: 'Lightweight',
    tier: 'Long context',
    threshold: '> 200K',
    input: '$0.40',
    output: '$1.80'
  }]);
  assert.deepEqual(prices[0], {
    provider: 'openai',
    model: 'GPT Test',
    category: 'Lightweight',
    tier: 'Long context',
    thresholdOperator: 'gt',
    thresholdTokens: 200_000,
    inputUsdPerMillionTokens: 0.4,
    outputUsdPerMillionTokens: 1.8
  });
});

test('pricing parser rejects unknown GitHub categories', () => {
  assert.throws(() => parsePricingCatalog({
    prices: [{
      provider: 'test',
      model: 'Unknown',
      category: 'Experimental',
      tier: 'Default',
      threshold_operator: null,
      threshold_tokens: null,
      input_usd_per_million_tokens: 1,
      output_usd_per_million_tokens: 1
    }]
  }), /unsupported category/);
});

test('pricing parser and runtime matcher use default tiers', () => {
  const prices = parsePricingCatalog({
    prices: [
      {
        provider: 'openai',
        model: 'GPT-5.6 Luna',
        category: 'Lightweight',
        tier: 'Default',
        threshold_operator: null,
        threshold_tokens: null,
        input_usd_per_million_tokens: 0.2,
        output_usd_per_million_tokens: 1.2
      },
      {
        provider: 'openai',
        model: 'GPT-5.6 Luna',
        category: 'Lightweight',
        tier: 'Long context',
        threshold_operator: 'gt',
        threshold_tokens: 200000,
        input_usd_per_million_tokens: 0.4,
        output_usd_per_million_tokens: 1.8
      }
    ]
  });
  const matched = findModelPrice(model('copilot/gpt-5.6-luna'), prices);
  assert.equal(matched?.tier, 'Default');
  assert.equal(matched?.inputUsdPerMillionTokens, 0.2);
});

test('task plans accept only bounded category-based tasks', () => {
  const plan = parseTaskPlan(JSON.stringify({
    version: 1,
    goal: 'Build the parser',
    tasks: [{
      title: 'Implement parser',
      category: 'Versatile',
      instructions: 'Implement the parser behind the existing interface.',
      successCriteria: ['Targeted tests pass']
    }]
  }));
  assert.equal(plan.tasks[0].category, 'Versatile');
  assert.match(taskPrompt(plan, plan.tasks[0], 0), /Task: 1 of 1/);
});

test('task plans reject model IDs and Markdown wrappers', () => {
  assert.throws(() => parseTaskPlan('```json\n{}\n```'), /without Markdown/);
  assert.throws(() => parseTaskPlan(JSON.stringify({
    version: 1,
    goal: 'Build the parser',
    tasks: [{
      title: 'Implement parser',
      category: 'Versatile',
      modelId: 'expensive-model',
      instructions: 'Implement it.',
      successCriteria: ['Tests pass']
    }]
  })), /unsupported or missing fields/);
});

test('task completion requires an explicit succeeded or failed marker', () => {
  assert.deepEqual(
    parseTaskCompletion('Done.\n<rigel_task_result>{"status":"succeeded","summary":"Tests passed."}</rigel_task_result>'),
    { status: 'succeeded', summary: 'Tests passed.' }
  );
  assert.deepEqual(
    parseTaskCompletion('<rigel_task_result>{"status":"failed","summary":"One test still fails."}</rigel_task_result>'),
    { status: 'failed', summary: 'One test still fails.' }
  );
  assert.throws(() => parseTaskCompletion('Looks good.'), /required task result marker/);
});

test('orchestration runs sequentially and stops on a stalled task', async () => {
  const plan = parseTaskPlan(JSON.stringify({
    version: 1,
    goal: 'Build the parser',
    tasks: [
      { title: 'Inspect', category: 'Lightweight', instructions: 'Inspect files.', successCriteria: ['Relevant files identified'] },
      { title: 'Implement', category: 'Versatile', instructions: 'Implement code.', successCriteria: ['Tests pass'] },
      { title: 'Document', category: 'Lightweight', instructions: 'Write docs.', successCriteria: ['Docs updated'] }
    ]
  }));
  const visited: string[] = [];
  const result = await runTaskPlan(plan, async task => {
    visited.push(task.title);
    return {
      state: task.title === 'Implement' ? 'stalled' : 'succeeded',
      model: 'test-model',
      actionCount: 1,
      summary: task.title
    };
  }, () => false);
  assert.deepEqual(visited, ['Inspect', 'Implement']);
  assert.equal(result.state, 'stalled');
  assert.equal(result.completedTasks, 1);
});

test('filesystem boundary distinguishes descendants from siblings', () => {
  assert.equal(isPathInside('/workspace/project', '/workspace/project/src/main.ts'), true);
  assert.equal(isPathInside('/workspace/project', '/workspace/project'), true);
  assert.equal(isPathInside('/workspace/project', '/workspace/project-secrets/key.txt'), false);
  assert.equal(isPathInside('/workspace/project', '/etc/passwd'), false);
});

test('workspace paths reject traversal and absolute paths', () => {
  assert.deepEqual(workspacePathParts('./src/main.ts'), ['src', 'main.ts']);
  assert.throws(() => workspacePathParts('../secret.txt'), /cannot leave/);
  assert.throws(() => workspacePathParts('/etc/passwd'), /relative/);
  assert.throws(() => workspacePathParts('C:\\secret.txt'), /relative/);
});

test('handoff is compact and explicit', () => {
  const handoff = createHandoff('Fix login', 'Sonnet', {
    action: 'escalate',
    reason: 'Repeated failure',
    evidence: ['test failed twice']
  });
  const rendered = renderHandoff(handoff);
  assert.match(rendered, /Goal: Fix login/);
  assert.match(rendered, /Previous model: Sonnet/);
  assert.match(rendered, /Re-evaluate the approach/);
});

async function main(): Promise<void> {
  let failures = 0;
  for (const current of tests) {
    try {
      await current.run();
      console.log(`✓ ${current.name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${current.name}`);
      console.error(error);
    }
  }

  console.log(`\n${tests.length - failures}/${tests.length} tests passed`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

void main();
