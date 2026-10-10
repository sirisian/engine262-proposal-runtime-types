import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/computed-constraint-admission.json', import.meta.url), 'utf8')) as {
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

const producer = 'function identity(t:type):type{return t;} export function outer<T:type>(x:T){type R<U:type=T>=identity(U);return function f<V:type extends R.<> >(y:V):V{return y;};}';
for (const valid of [false, true]) {
  test(`imported computed constraint admission (${valid})`, async () => {
    const result = await observeModuleGraph({
      dep: producer,
      main: 'import {outer as make} from "dep";const fn=make.<string>("x");function use<T:type>(){type R=uint8;return fn.<'
        + (valid ? 'string>("ok")' : 'uint8>(1)') + ';}' + (valid ? 'use.<uint8>();' : ''),
    });
    expect(result).toMatchObject(valid
      ? { status: 'fulfilled', bodyEntries: ['dep', 'main'] }
      : { status: 'rejected', bodyEntries: ['dep'], errorClass: 'StaticTypeError',
        diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'pre-evaluation' } });
    if (valid) expect(result.diagnostic).toBeUndefined();
  });
}

test('computed constraint retains an imported helper at runtime admission', async () => {
  const result = await observeModuleGraph({
    lib: 'export function identity(t:type):type{return t;}',
    dep: producer.replace('function identity(t:type):type{return t;}', 'import {identity} from "lib";'),
    main: 'import {outer} from "dep";function identity(t:type):type{return type uint8;}const fn:any=outer.<string>("x");let g:<V:type extends string>(y:V)=>V=fn;g.<string>("ok");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['lib', 'dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

for (const valid of [false, true]) {
  test(`generated Function computed constraint (${valid})`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const source = producer.replace('export ', '')
      + 'const fn=outer.<string>("x");' + (valid ? 'return fn.<string>("ok");' : 'function unused(){fn.<uint8>(1);}return "missed";');
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(
      `let outcome="missed";try{outcome=Function(${JSON.stringify(source)})();}catch(e){outcome=e.name;}outcome;`,
    ));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(valid ? 'ok' : 'StaticTypeError');
  });
}
