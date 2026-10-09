import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/alias-publication.json', import.meta.url), 'utf8')) as {
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

for (const [form, declaration] of [
  ['plain', 'export type Known=string;'],
  ['computed', 'function build(){return type string;}export type Known=build();'],
]) {
  for (const [route, mainImport, extra] of [
    ['direct', 'import {Known} from "dep";', {}],
    ['renamed re-export', 'import {Renamed as Known} from "bridge";', { bridge: 'export {Known as Renamed} from "dep";' }],
  ] as const) {
    for (const valid of [true, false]) {
      test(`${form} alias retains its ${route} target after a private same-named alias (${valid ? 'valid' : 'invalid'})`, async () => {
        const result = await observeModuleGraph({
          main: `${mainImport} function f(x:Known):Known{return ${valid ? '"ok"' : '1'};}`,
          dep: `${declaration} function privateScope(){type Known=uint8;}privateScope();`,
          ...extra,
        });
        expect(result.status).toBe(valid ? 'fulfilled' : 'rejected');
        expect(result.bodyEntries).toEqual(!valid && form === 'plain' ? [] : route === 'direct'
          ? valid ? ['dep', 'main'] : ['dep'] : valid ? ['dep', 'bridge', 'main'] : ['dep', 'bridge']);
        if (valid) {
          expect(result.errorClass).toBeUndefined();
          expect(result.diagnostic).toBeUndefined();
        } else {
          expect(result.errorClass).toBe('StaticTypeError');
          expect(result.diagnostic).toMatchObject({ code: 'RT_ASSIGNABILITY', phase: form === 'plain' ? 'static' : 'pre-evaluation' });
        }
      });
    }
  }
  test(`an unexported ${form} module alias does not become visible to its importer`, async () => {
    const result = await observeModuleGraph({
      main: 'import "dep";function outer(){function f<[].<Hidden>>(x:string):string{return x;}}',
      dep: declaration.replace('export ', '').replaceAll('Known', 'Hidden'),
    });
    expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['dep'], errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' } });
  });
}

test('completed aliases in a different realm cannot supply a missing binding', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const first = new ManagedRealm();
  const second = new ManagedRealm();
  expect(EnsureCompletion(first.evaluateScriptSkipDebugger('type Hidden=string;')).Type).toBe('normal');
  const failure = EnsureCompletion(second.evaluateScriptSkipDebugger('function f<[].<Hidden>>(x:string):string{return x;}'));
  expect(failure.Type).toBe('throw');
  expect(TypeDiagnosticOf(failure.Value)).toMatchObject({ code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' });
  expect(EnsureCompletion(second.evaluateScriptSkipDebugger('type Hidden=uint8;')).Type).toBe('normal');
  expect(EnsureCompletion(first.evaluateScriptSkipDebugger('function f(x:Hidden):Hidden{return "ok";}')).Type).toBe('normal');
});
