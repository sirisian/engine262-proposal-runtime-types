import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph, observeModuleSequence } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/destructuring-provenance.json', import.meta.url), 'utf8')) as {
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

for (const erased of [false, true]) {
  test(`a failed destructuring contract does not annotate the next graph's literal (${erased})`, async () => {
    const results = await observeModuleSequence({
      bad: `function make()${erased ? ':any' : ''}{const {inner:{x}}={inner:{x:"s":=string}};return x;}const n:number=make();`,
      untyped: 'function make(){const {inner:{x}}={inner:{x:"s"}};return x;}const n:number=make();',
      good: 'function make(){const {inner:{x}}={inner:{x:"s"}};return x;}const f=make();if(f!=="s")throw new Error("value");',
    }, ['bad', 'untyped', 'good', 'bad']);
    expect(results[0]).toMatchObject({ status: 'rejected', bodyEntries: erased ? ['bad'] : [],
      errorClass: erased ? 'TypeError' : 'StaticTypeError' });
    if (erased) expect(results[0].diagnostic).toBeUndefined();
    else expect(results[0].diagnostic).toMatchObject({ code: 'RT_RETURN_CONTRACT', phase: 'static' });
    expect(results[1]).toMatchObject({ status: 'rejected', bodyEntries: ['untyped'], errorClass: 'TypeError' });
    expect(results[1].diagnostic).toBeUndefined();
    expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
    expect(results[2].diagnostic).toBeUndefined();
    expect(results[3]).toMatchObject({ status: 'rejected', bodyEntries: [],
      errorClass: erased ? 'TypeError' : 'StaticTypeError' });
  });
}
