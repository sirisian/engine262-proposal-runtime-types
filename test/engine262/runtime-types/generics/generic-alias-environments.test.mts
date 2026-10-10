import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/generic-alias-environments.json', import.meta.url), 'utf8')) as {
  cases: { name: string; steps: { source: string; expected: Record<string, unknown> }[] }[];
};
for (const { name, steps } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    try {
      for (const { source, expected } of steps) {
        let bodyEntered = false;
        let scriptBodies = 0;
        agent.hostDefinedOptions.onNodeEvaluation = (node) => {
          if (node.type === 'ScriptBody') {
            bodyEntered = true;
            scriptBodies += 1;
          }
        };
        const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
        const diagnostic = TypeDiagnosticOf(completion.Value);
        const errorClass = completion.Type === 'throw' && completion.Value instanceof ObjectValue
          ? ['Error', 'SyntaxError', 'TypeError', 'ReferenceError', 'StaticTypeError'].find((kind) =>
            completion.Value.Prototype === realm.Intrinsics[`%${kind}.prototype%`]) : undefined;
        expect({ completion: completion.Type, bodyEntered, scriptBodies, errorClass, diagnostic,
          value: completion.Type === 'normal' ? (completion.Value as { stringValue?: () => string })?.stringValue?.() : undefined }).toMatchObject(expected);
        if (!expected.errorClass) expect(errorClass).toBeUndefined();
        if (!expected.diagnostic) expect(diagnostic).toBeUndefined();
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

for (const route of ['helper', 'alias', 'default']) {
  for (const valid of [false, true]) {
    test(`imported generic ${route} retains its declaration environment (${valid ? 'valid' : 'invalid'})`, async () => {
      const result = await observeModuleGraph({
        dep: 'type Free=string;export type Box<T:type=Free>=[Free,T];export function build(){return type Box.<string>;}',
        main: (route === 'helper' ? 'import {build} from "dep";'
          : 'import {Box} from "dep";function build(){type Free=uint8;return type Box.' + (route === 'default' ? '<>' : '<string>') + ';}')
          + `function outer(){type Box<T:type>=[uint8];type Known=build();function f():Known{return ${valid ? '["ok","ok"]' : '[1,1]'};}}`,
      });
      if (valid) {
        expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
        expect(result.diagnostic).toBeUndefined();
        expect(result.errorClass).toBeUndefined();
      } else {
        expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['dep'], errorClass: 'StaticTypeError',
          diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'pre-evaluation' } });
      }
    });
  }
}
