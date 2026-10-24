import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph, observeModuleSequence } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/adopted-generic-inputs.json', import.meta.url), 'utf8')) as {
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
  test(`failed concrete admission leaves later graphs intact (${form})`, async () => {
    const select = (suffix: string) => corpus.cases.find((entry) => entry.name === `${form}-${suffix}`)!.modules.main;
    const prefix = select('bound-materialization').split('const held:')[0];
    const results = await observeModuleSequence({
      bad: prefix + 'const held:(value:string)=>{captured:number,own:string}=erased;',
      good: select('bad-then-good-admission'), other: select('open-activation-reflection'),
    }, ['bad', 'good', 'other', 'bad']);
    expect(results[0]).toMatchObject({ status: 'rejected', bodyEntries: ['bad'], errorClass: 'TypeError' });
    expect(results[1]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
    expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['other'] });
    expect(results[3]).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'TypeError' });
    for (const result of results) expect(result.diagnostic).toBeUndefined();
  });
}
