import { expect, test } from 'vitest';
import { InferenceResources, type InferenceLimits } from '../../../../src/type-system/inference-limits.mts';
import type { ParseNode } from '../../../../src/parser/ParseNode.mts';
import { Agent, ManagedRealm, TypeDiagnosticOf, EnsureCompletion, setSurroundingAgent } from '#self';

function context(limits: InferenceLimits, enabled = true) {
  const agent = new Agent({ features: enabled ? ['runtime-types'] : [] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ returnInferenceBudget: limits } as never);
  let bodyEntered = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyEntered = true;
  };
  const run = (source: string, forced = false) => {
    bodyEntered = false;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source, { forceCheckedCode: forced }));
    return { completion: result.Type, diagnostic: TypeDiagnosticOf(result.Value), bodyEntered,
      value: (result.Value as { stringValue?: () => string }).stringValue?.() };
  };
  return { realm, run };
}

for (const kind of ['evaluations', 'results', 'depth'] as const) {
  test(`${kind} exhaustion is distinct from divergence and prevents body entry`, () => {
    const { run } = context({ [kind]: 0 });
    expect(run('function f(n:uint32){return n;} f(1);')).toMatchObject({
      completion: 'throw', bodyEntered: false,
      diagnostic: { code: 'RT_INFERENCE_LIMIT', rule: 'rt-inference-limit', phase: 'static' },
    });
    expect(run('"after";')).toMatchObject({ completion: 'normal', bodyEntered: true, value: 'after' });
  });
}

test('finite projection can exhaust a small allowance and succeed with a larger one', () => {
  const nested = '{value:'.repeat(16) + 'node' + '}'.repeat(16);
  const source = `class Leaf { get value():Leaf { return this; } }
    function f(n:uint32,node:Leaf){return n>1?f(n,node).value:${nested};} "ok";`;
  const small = context({ results: 3 });
  expect(small.run(source)).toMatchObject({ completion: 'throw', bodyEntered: false,
    diagnostic: { code: 'RT_INFERENCE_LIMIT' } });
  (small.realm.HostDefined as { returnInferenceBudget: InferenceLimits }).returnInferenceBudget = { results: 128 };
  expect(small.run(source)).toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
});

test('an unproved growing component reports resource exhaustion without an invented result', () => {
  const { run } = context({ results: 4 });
  expect(run('function a(n:uint32){return [b(n)];} function b(n:uint32){return [a(n)];}')).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
  });
  expect(run('typeof a;')).toMatchObject({ completion: 'normal', value: 'undefined' });
});

test('required dependency depth shares the source allowance', () => {
  const source = 'function a(n:uint32){return b(n);} function b(n:uint32){return c(n);} function c(n:uint32){return n;} "ok";';
  expect(context({ depth: 1 }).run(source)).toMatchObject({ completion: 'throw', diagnostic: { code: 'RT_INFERENCE_LIMIT' } });
  expect(context({ depth: 8 }).run(source)).toMatchObject({ completion: 'normal', value: 'ok' });
});

test('resource failure supersedes an incidental consumer mismatch', () => {
  expect(context({ results: 0 }).run('function f(n:uint32){return n;} const bad:string=f(0);')).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
  });
});

test('feature-disabled legacy code does not spend the inference allowance', () => {
  expect(context({ evaluations: 0 }, false).run('function f(){return 1;} "ok";')).toMatchObject({
    completion: 'normal', bodyEntered: true, value: 'ok', diagnostic: undefined,
  });
});

test('forced legacy checking uses the same resource-failure boundary', () => {
  expect(context({ evaluations: 0 }).run('function f(){return 1;} "ok";', true)).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
  });
});

test('exact allowances are usable and exhaustion remains sticky while unwinding', () => {
  const declaration = { type: 'FunctionDeclaration' } as ParseNode;
  const resources = new InferenceResources({ evaluations: 2, results: 2, depth: 2 });
  expect(resources.enter(declaration)).toBe(true);
  expect(resources.enter(declaration)).toBe(true);
  const first = { Kind: 'union', Members: [] } as const;
  const second = { Kind: 'any' } as const;
  resources.result(declaration, first, Object.is);
  resources.result(declaration, second, Object.is);
  resources.result(declaration, first, Object.is);
  expect(resources.exhausted).toBeUndefined();
  resources.result(declaration, null, Object.is);
  expect(resources.exhausted?.kind).toBe('results');
  resources.leave();
  resources.leave();
  expect(resources.enter(declaration)).toBe(false);
  expect(resources.exhausted?.kind).toBe('results');
});

for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid inference limit ${value} cannot disable metering`, () => {
    expect(() => new InferenceResources({ evaluations: value })).toThrow(RangeError);
  });
}
