import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, type OrdinaryObject } from '#self';
import { observeScript } from '../harness.mts';

let serial = 0;
const cases = ['field', 'method'].flatMap((member) => ['realm', 'agent'].flatMap((boundary) => (
  ['alias', 'interface', 'exhaustion'].map((warmup) => ({ member, boundary, warmup }))
)));

// #sec-declaration-preparation-state: prior checking cannot supply recursion evidence.
test.each(cases)('$member resolution is independent of a previous $warmup across a new $boundary', ({ member, boundary, warmup }) => {
  const name = `PreparationName${serial++}`;
  const source = `function make() { return 5; } const ${name} = make(); interface I { `
    + (member === 'field' ? `n: ${name};` : `m(x: ${name}): void;`) + ' }';
  let agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  let bodyEntered = false;
  const observeBody = (node: { type: string }) => { if (node.type === 'ScriptBody') bodyEntered = true; };
  agent.hostDefinedOptions.onNodeEvaluation = observeBody;
  const cold = new ManagedRealm();
  const coldResult = EnsureCompletion(cold.evaluateScriptSkipDebugger(source));
  expect(coldResult.Type).toBe('throw');
  expect(bodyEntered).toBe(true);
  expect((coldResult.Value as OrdinaryObject).Prototype).toBe(cold.Intrinsics['%TypeError.prototype%']);
  expect(TypeDiagnosticOf(coldResult.Value)).toBeUndefined();

  const warm = new ManagedRealm(warmup === 'exhaustion' ? { typeEvaluationBudget: { steps: 0 } } as never : undefined);
  const preparation = warmup === 'interface' ? `interface ${name} {}` : `type ${name} = string;`;
  const work = warmup === 'exhaustion' ? ' function build(T: type): type { return T; } type Built = build(uint8);' : '';
  const warmResult = EnsureCompletion(warm.evaluateScriptSkipDebugger(preparation + work));
  if (warmup === 'exhaustion') {
    expect(TypeDiagnosticOf(warmResult.Value)?.code).toBe('RT_TYPE_EVALUATION_LIMIT');
  } else {
    expect(warmResult.Type).toBe('normal');
  }
  if (boundary === 'agent') {
    agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    agent.hostDefinedOptions.onNodeEvaluation = observeBody;
  }
  bodyEntered = false;
  const later = new ManagedRealm();
  const result = EnsureCompletion(later.evaluateScriptSkipDebugger(source));
  expect(result.Type).toBe('throw');
  expect(bodyEntered).toBe(true);
  expect((result.Value as OrdinaryObject).Prototype).toBe(later.Intrinsics['%TypeError.prototype%']);
  expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
});

test.each([
  'interface N { next: N | null; }',
  'interface A { next: B | null; } interface B { next: A | null; }',
  'interface N { m(x: N): N; }',
  'interface N<T: type> { value: T; next: N.<T> | null; } function unused(n: N.<uint8>) {}',
])('valid recursive declaration remains accepted: %s', (source) => {
  expect(observeScript(source)).toMatchObject({ completion: { Type: 'normal' }, bodyEntered: true, diagnostic: undefined });
});

test.each(['automatic', 'disabled'] as const)('ordinary TDZ reads remain native ReferenceErrors in %s mode', (mode) => {
  expect(observeScript('x; let x;', mode)).toMatchObject({
    completion: { Type: 'throw' }, bodyEntered: true, errorClass: 'ReferenceError', diagnostic: undefined,
  });
});
