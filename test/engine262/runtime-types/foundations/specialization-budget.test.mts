import { expect, test } from 'vitest';
import { observeModuleSequence } from '../module-observer.mts';
import { Agent, ManagedRealm, ParseScript, ParseModule, EnsureCompletion, TypeDiagnosticOf, TypeEvaluationBudget, setSurroundingAgent } from '#self';

type Limits = { steps?: number, records?: number, depth?: number };
const growing = 'type G<T: type> = { f: (G.<[].<T>>) => void };';

function context(limits?: Limits) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ typeEvaluationBudget: limits } as never);
  let bodyEntered = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyEntered = true;
  };
  const run = (source: string) => {
    setSurroundingAgent(agent);
    bodyEntered = false;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    return { completion: result.Type, bodyEntered, diagnostic: TypeDiagnosticOf(result.Value),
      value: (result.Value as { stringValue?: () => string }).stringValue?.() };
  };
  return { realm, run };
}

const exhausted = {
  completion: 'throw', bodyEntered: false,
  diagnostic: { code: 'RT_TYPE_EVALUATION_LIMIT', rule: 'rt-type-evaluation-limit', phase: 'static', errorClass: 'StaticTypeError' },
};

test.each([undefined, 8, 32, 64, 256])('growing static obligations reach depth %s without a native overflow', (depth) => {
  const { run } = context(depth === undefined ? undefined : { depth });
  const result = run(`${growing} type X = G.<uint8>; String(1);`);
  expect(result).toMatchObject(exhausted);
  expect(result.diagnostic?.arguments[0]).toBe('"depth"');
  expect(TypeEvaluationBudget.BudgetSpent()).toBeNull();
});

test.each([
  growing,
  `function unused() { ${growing} type X = G.<uint8>; }`,
  'type G<T: type> = { next: G.<[].<T>> | null }; type X = G.<uint8>;',
  'type G<T: type> = { f: (H.<T>) => void }; type H<T: type> = G.<[].<T>>; type X = G.<uint8>;',
])('growing obligations are contained wherever checking discovers them: %s', (source) => {
  expect(context({ depth: 32 }).run(`${source} "entered";`)).toMatchObject(exhausted);
});

test('step exhaustion is sticky and cannot be caught by the candidate source', () => {
  const result = context({ steps: 8, depth: 256 }).run(`try { ${growing} type X = G.<uint8>; } catch (e) {} "fallback";`);
  expect(result).toMatchObject(exhausted);
  expect(result.diagnostic?.arguments[0]).toBe('"steps"');
});

test('exhausted preparation publishes no bindings and later evaluations start fresh', () => {
  const { realm, run } = context({ depth: 8 });
  expect(run(`${growing} type X = G.<uint8>; var leaked = 1;`)).toMatchObject(exhausted);
  expect(run('typeof G + "," + typeof leaked;')).toMatchObject({ completion: 'normal', value: 'undefined,undefined' });
  (realm.HostDefined as { typeEvaluationBudget: Limits }).typeEvaluationBudget = { depth: 256 };
  expect(run('type G<T: type> = { f: (G.<T>) => void }; type X = G.<uint8>; "ok";'))
    .toMatchObject({ completion: 'normal', value: 'ok', diagnostic: undefined });
});

test('a finite cycle of changing inputs preserves its separate contracts', () => {
  expect(context().run('type G<T: type, U: type> = { value: T, f: (G.<U, T>) => void }; '
    + 'type A = G.<uint8, string>; type B = G.<string, uint8>; String(A === B);'))
    .toMatchObject({ completion: 'normal', value: 'false', diagnostic: undefined });
});

test('a finite dependency chain succeeds with enough fuel and still checks its erased constraint', () => {
  const aliases = 'type A<T: type> = B.<T>; type B<T: type> = C.<T>; '
    + 'type C<T: type> = D.<T>; type D<T: type extends uint8> = number;';
  const { realm, run } = context({ depth: 2 });
  expect(run(`${aliases} type X = A.<uint8>; "ok";`)).toMatchObject(exhausted);
  (realm.HostDefined as { typeEvaluationBudget: Limits }).typeEvaluationBudget = { depth: 64 };
  expect(run(`{ ${aliases} type X = A.<uint8>; "ok"; }`))
    .toMatchObject({ completion: 'normal', value: 'ok', diagnostic: undefined });
  expect(run(`{ ${aliases} type X = A.<string>; "bad"; }`)).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' },
  });
});

test('dynamic-function narrowing recovery cannot discard specialization exhaustion', () => {
  const { run } = context({ depth: 32 });
  const source = 'let x: uint8 | null = null; if (x !== null) { const y: uint8 = x; } '
    + growing + ' type X = G.<uint8>;';
  expect(run(`Function(${JSON.stringify(source)});`)).toMatchObject({
    completion: 'throw', diagnostic: exhausted.diagnostic,
  });
  expect(TypeEvaluationBudget.BudgetSpent()).toBeNull();
  expect(run('Function("return 1;")(); "ok";')).toMatchObject({ completion: 'normal', value: 'ok' });
});

test('failed module preparation does not contaminate a later module', async () => {
  const results = await observeModuleSequence({
    bad: `export ${growing} export type X = G.<uint8>;`,
    good: 'type G<T: type> = { f: (G.<T>) => void }; type X = G.<uint8>;',
  }, ['bad', 'good'], { typeEvaluationBudget: { depth: 32 } });
  expect(results[0]).toMatchObject({ status: 'rejected', bodyEntries: [], diagnostic: exhausted.diagnostic });
  expect(results[1]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'], diagnostic: undefined });
});

test.each([['script', ParseScript], ['module', ParseModule]] as const)('%s parsing contains exhaustion without an active context', (_name, parse) => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ typeEvaluationBudget: { depth: 8 } } as never);
  expect(agent.executionContextStack.length).toBe(0);
  const result = parse(growing, realm, {});
  expect(Array.isArray(result) ? result.map(TypeDiagnosticOf) : [])
    .toEqual([expect.objectContaining(exhausted.diagnostic)]);
  expect(agent.executionContextStack.length).toBe(0);
  expect(TypeEvaluationBudget.BudgetSpent()).toBeNull();
});
