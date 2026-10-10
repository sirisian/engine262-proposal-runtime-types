import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/deferred-environments.json', import.meta.url), 'utf8')) as {
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

for (const importedHelper of [false, true]) {
  for (const valid of [false, true]) {
    test(`${importedHelper ? 'imported helper' : 'local helper with imported alias'} retains its scope (${valid ? 'valid' : 'invalid'})`, async () => {
      const result = await observeModuleGraph({
        dep: 'export type Target=string;export function build(){return type Target;}',
        main: (importedHelper ? 'import {build} from "dep";' : 'import {Target} from "dep";function build(){return type Target;}')
          + `function outer(){type Target=uint8;type Known=build();function f(x:Known):Known{return ${valid ? '\"ok\"' : '1'};}}`,
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
