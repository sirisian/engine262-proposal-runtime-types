import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/comparison-participation.json', import.meta.url), 'utf8')) as {
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

for (const kind of ['comparison', 'known key']) {
  for (const conflict of [false, true]) {
    const source = kind === 'comparison'
      ? `function f(a:${conflict ? 'uint8' : 'uint8|string'},b:string):boolean{return a===b;}`
      : `function f(o:{n:uint8}):${conflict ? 'string' : 'uint8'}{let k:string="n";return o[k];}`;
    const rule = kind === 'comparison' ? 'rt-disjoint-comparison' : 'rt-assignability';
    test(`generated Function ${kind} (conflict=${conflict})`, () => {
      setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
      const realm = new ManagedRealm();
      const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(source)});"accepted";`));
      expect(result.Type).toBe(conflict ? 'throw' : 'normal');
      if (conflict) expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule, phase: 'static' });
      else expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
    });
    test(`importing Module ${kind} (conflict=${conflict})`, async () => {
      const result = await observeModuleGraph({ dep: source+'export {f};', main: 'import {f} from "dep";' });
      expect(result).toMatchObject(conflict
        ? { status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { rule, phase: 'static' } }
        : { status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    });
  }
}

for (const source of ['String(1==="1");', 'let o={n:1};let k="n";String(o[k]);']) {
  test(`feature-off comparison/key ${source}`, () => {
    setSurroundingAgent(new Agent());
    const result = EnsureCompletion(new ManagedRealm().evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(source.startsWith('String') ? 'false' : '1');
  });
}
