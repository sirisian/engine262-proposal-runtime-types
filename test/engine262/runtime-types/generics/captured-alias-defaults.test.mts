import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/captured-alias-defaults.json', import.meta.url), 'utf8')) as {
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

const producer = 'function identity(t:type):type{return t;} export function outer<T:type>(x:T){type R<U:type=T>=identity(U);return function f<V:type=R.<> >(y:V):V{return y;};}';
for (const valid of [false, true]) {
  test(`imported producer retains alias captures (${valid})`, async () => {
    const result = await observeModuleGraph({
      dep: producer,
      main: 'import {outer as make} from "dep";const fn=make.<string>("x");function use<T:type>(){type R=uint8;const g=fn.<>;return g('
        + (valid ? '"ok"' : '1') + ');}' + (valid ? 'use.<uint8>();' : ''),
    });
    expect(result).toMatchObject(valid
      ? { status: 'fulfilled', bodyEntries: ['dep', 'main'] }
      : { status: 'rejected', bodyEntries: ['dep'], errorClass: 'StaticTypeError',
        diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'pre-evaluation' } });
    if (valid) expect(result.diagnostic).toBeUndefined();
  });
}

test('dynamic Function checks a published captured default before its generated body', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const source = producer.replace('export ', '')
    + 'const fn=outer.<string>("x");function use<T:type>(){const g=fn.<>;return g(1);}throw new Error("body entered");';
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(
    `let outcome="missed";try{Function(${JSON.stringify(source)})();}catch(e){outcome=e.name;}outcome;`,
  ));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue(): string }).stringValue()).toBe('StaticTypeError');
});
