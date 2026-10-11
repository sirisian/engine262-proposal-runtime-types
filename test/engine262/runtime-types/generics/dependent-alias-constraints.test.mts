import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/dependent-alias-constraints.json', import.meta.url), 'utf8')) as {
  cases: { name: string; steps: { source: string; expected: Record<string, unknown>; messageIncludes?: string }[] }[];
};
for (const { name, steps } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    try {
      for (const { source, expected, messageIncludes } of steps) {
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
        if (messageIncludes) expect((completion.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString).toContain(messageIncludes);
        if (!expected.errorClass) expect(errorClass).toBeUndefined();
        if (!expected.diagnostic) expect(diagnostic).toBeUndefined();
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

const producer = 'export function outer<T:type>(x:T){type R<U:type extends string> =string;return function f<V:type extends R.<T> >(y:V):V{return y;};}';
for (const valid of [false, true]) {
  test(`imported dependent alias constraint (${valid})`, async () => {
    const result = await observeModuleGraph({ dep: producer,
      main: 'import {outer} from "dep";'
        + (valid ? 'const fn=outer.<string>("x");fn.<string>("ok");' : 'const fn=outer.<uint8>(1);'),
    });
    expect(result).toMatchObject(valid
      ? { status: 'fulfilled', bodyEntries: ['dep', 'main'] }
      : { status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
        diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
    if (valid) expect(result.diagnostic).toBeUndefined();
  });
  test(`generated Function dependent alias constraint (${valid})`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const source = producer.replace('export ', '')
      + (valid ? 'const fn=outer.<string>("x");return fn.<string>("ok");' : 'const fn=outer.<uint8>(1);return "missed";');
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(
      `let outcome="missed";try{outcome=Function(${JSON.stringify(source)})();}catch(e){outcome=e.name;}outcome;`,
    ));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(valid ? 'ok' : 'StaticTypeError');
  });
}
