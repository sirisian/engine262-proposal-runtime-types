import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph, observeModuleSequence } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/dependent-construction.json', import.meta.url), 'utf8')) as {
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

for (const inner of ['string', 'number']) {
  test(`failed captured contract preserves later generic contexts (${inner})`, async () => {
    const argument = inner === 'string' ? '"s"' : '1';
    const factory = 'function factory<T:type>(seed:T){function get<T:type>(other:T){return {captured:seed,own:other};}return {get};}';
    const results = await observeModuleSequence({
      bad: factory + 'function make(seed:number){return factory.<number>(seed).get.<string>("s").captured;}const n:string=make(0);',
      good: factory + `const pair=factory(0).get.<${inner}>(${argument});function verify(value:any){if(typeof value!=="number"||value!==0)throw new Error("capture");}verify(pair.captured);if(pair.own!==${argument})throw new Error("own");`,
      other: factory + 'const pair=factory("s").get.<number>(1);if(pair.captured!=="s"||pair.own!==1)throw new Error("capture");',
    }, ['bad', 'good', 'other', 'bad']);
    for (const index of [0, 3]) {
      expect(results[index]).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
        diagnostic: { code: 'RT_RETURN_CONTRACT', phase: 'static' } });
    }
    expect(results[1]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
    expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['other'] });
    expect(results[1].diagnostic).toBeUndefined();
    expect(results[2].diagnostic).toBeUndefined();
  });
}
