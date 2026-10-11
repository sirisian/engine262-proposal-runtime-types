import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/concatenation-checking.json', import.meta.url), 'utf8')) as {
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

for (const conflict of [false, true]) {
  const source = conflict
    ? 'function f(s:"a",n:uint8):uint8{return n+s;}'
    : 'function f(s:"a",n:uint8):string{return n+s;}';
  test(`generated Function String result (conflict=${conflict})`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(source)});"accepted";`));
    expect(result.Type).toBe(conflict ? 'throw' : 'normal');
    if (conflict) expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule: 'rt-assignability', phase: 'static' });
    else expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
  });
  test(`importing Module String result (conflict=${conflict})`, async () => {
    const result = await observeModuleGraph({ dep: source+'export {f};', main: 'import {f} from "dep";' });
    expect(result).toMatchObject(conflict
      ? { status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability', phase: 'static' } }
      : { status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  });
}

for (const source of ['const s="a";let n=1;String(n+s);', 'const s="a";let n=1;String(s+n);']) {
  test(`feature-off concatenation ${source}`, () => {
    setSurroundingAgent(new Agent());
    const result = EnsureCompletion(new ManagedRealm().evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(source.includes('n+s') ? '1a' : 'a1');
  });
}
