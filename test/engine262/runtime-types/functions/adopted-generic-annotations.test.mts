import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph, observeModuleSequence } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/adopted-generic-annotations.json', import.meta.url), 'utf8')) as {
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

for (const form of ['method', 'function', 'arrow']) {
  test(`closed annotation failure preserves later adopted scopes (${form})`, async () => {
    const select = (suffix: string) => corpus.cases.find((entry) => entry.name === `${form}-${suffix}`)!.modules.main;
    const results = await observeModuleSequence({
      bad: select('closed-builder-failure'), good: select('two-activations'), other: select('selected-value-default'),
    }, ['bad', 'good', 'other', 'bad']);
    for (const index of [0, 3]) {
      expect(results[index]).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
        diagnostic: { code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' } });
    }
    expect(results[1]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
    expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['other'] });
    for (const index of [1, 2]) {
      expect(results[index].errorClass).toBeUndefined();
      expect(results[index].diagnostic).toBeUndefined();
    }
  });
}
