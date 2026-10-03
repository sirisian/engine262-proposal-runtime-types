import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, EnsureCompletion, setSurroundingAgent, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/constraint-completions.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source?: string; modules?: Record<string, string>; expected: Record<string, unknown> }[];
};

for (const { name, source, modules, expected } of corpus.cases) {
  test(name, async () => {
    const observation = modules ? await observeModuleGraph(modules) : (() => {
      const result = observeScript(source!);
      return { ...result, completion: result.completion.Type };
    })();
    expect(observation).toMatchObject(expected);
    if (!expected.diagnostic) expect(observation.diagnostic).toBeUndefined();
    if (!expected.errorClass) expect(observation.errorClass).toBeUndefined();
  });
}

function checkWithBudget(source: string, steps: number) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ typeEvaluationBudget: { steps } } as never);
  let bodyEntered = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyEntered = true;
  };
  try {
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    return { completion: result.Type, bodyEntered, diagnostic: TypeDiagnosticOf(result.Value) };
  } finally {
    delete agent.hostDefinedOptions.onNodeEvaluation;
  }
}

const work = 'let i=0; while(i<1000){i++;}';

test('resource exhaustion precedes an eventual predicate throw', () => {
  const source = `function check(n){${work} throw n;}
    function F<N:uint32>():void where check(N) {} function unused(){F.<1>();}`;
  expect(checkWithBudget(source, 100)).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_TYPE_EVALUATION_LIMIT' },
  });
  expect(checkWithBudget(source, 100_000)).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' },
  });
});

test('a helper catch cannot turn exhaustion into successful verification', () => {
  const source = `function check(n){try{${work}}catch(e){return true;} return true;}
    type F<N:uint32>=uint8 where check(N); function unused(){let x:F.<1>;}`;
  expect(checkWithBudget(source, 100)).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_TYPE_EVALUATION_LIMIT' },
  });
  expect(checkWithBudget(source, 100_000)).toMatchObject({ completion: 'normal', bodyEntered: true });
});

test('predicate failure restores the environment for another source check', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const failed = EnsureCompletion(realm.evaluateScriptSkipDebugger(
    'function F<T:type>():void where T.missing() {} function unused(){F.<uint8>();}',
  ));
  expect(TypeDiagnosticOf(failed.Value)?.code).toBe('RT_TYPE_EVALUATION');
  const valid = EnsureCompletion(realm.evaluateScriptSkipDebugger(
    'function G<T:type>():void where T === uint8 {} G.<uint8>();',
  ));
  expect(valid.Type).toBe('normal');
  expect(TypeDiagnosticOf(valid.Value)).toBeUndefined();
});
