import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph, observeModuleSequence } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/selected-union-admission.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; script: boolean; expected: {
    status: 'fulfilled' | 'rejected'; bodyEntries: string[]; errorClass?: string; diagnostic?: Record<string, unknown>;
  } }[];
};

for (const { name, modules, expected, script } of corpus.cases) {
  test(`Module: ${name}`, async () => {
    const result = await observeModuleGraph(modules);
    expect(result).toMatchObject(expected);
    if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
    if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
  });
  if (!script) continue;
  test(`Script: ${name}`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    let bodies = 0;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => { if (node.type === 'ScriptBody') bodies += 1; };
    try {
      const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(modules.main));
      const errorClass = completion.Type === 'throw' ? nativeErrorClass(completion.Value, realm) : undefined;
      const diagnostic = TypeDiagnosticOf(completion.Value);
      expect(completion.Type).toBe(expected.status === 'fulfilled' ? 'normal' : 'throw');
      expect(bodies).toBe(expected.bodyEntries.length);
      expect(errorClass).toBe(expected.errorClass);
      if (expected.diagnostic) expect(diagnostic).toMatchObject(expected.diagnostic);
      else expect(diagnostic).toBeUndefined();
      expect(agent.jobQueue?.length ?? 0).toBe(0);
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

for (const form of ['function', 'arrow', 'method']) {
  for (const order of [0, 1]) {
    test(`failed selected admission leaves a later graph independent (${form}, ${order})`, async () => {
      const source = (suffix: string) => corpus.cases.find((entry) => entry.name === `${form}-${order}-${suffix}`)!.modules.main;
      const results = await observeModuleSequence({ bad: source('runtime-failure'), good: source('const'),
        later: source('existing-value-control') }, ['bad', 'good', 'later', 'bad']);
      for (const index of [0, 3]) {
        expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'TypeError' });
        expect(results[index].bodyEntries).toEqual(index === 0 ? ['bad'] : []);
        expect(results[index].diagnostic).toBeUndefined();
      }
      for (const [index, name] of [[1, 'good'], [2, 'later']] as const) {
        expect(results[index]).toMatchObject({ status: 'fulfilled', bodyEntries: [name] });
        expect(results[index].errorClass).toBeUndefined();
        expect(results[index].diagnostic).toBeUndefined();
      }
    });
  }
}
