import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/static-reference-forwarding.json', import.meta.url), 'utf8')) as {
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

for (const ref of [false, true]) {
  const declaration = 'function g(' + (ref ? 'ref ' : '') + '...ys:[].<uint8>){}';
  const wrapper = 'function unused(ref ...xs:[].<uint8>){g(...xs);}';
  test(`generated Function checks unused forwarding (ref=${ref})`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    let scripts = 0;
    let bodies = 0;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === 'ScriptBody') scripts += 1;
      if (node.type === 'FunctionBody') bodies += 1;
    };
    try {
      // Construction checks the unused wrapper; the generated body is never called.
      const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(
        `Function(${JSON.stringify(declaration + wrapper)}); "accepted";`,
      ));
      expect(scripts).toBe(1);
      expect(bodies).toBe(0);
      if (ref) {
        expect(result.Type).toBe('normal');
        expect(TypeDiagnosticOf(result.Value)).toBeUndefined();
      } else {
        expect(result.Type).toBe('throw');
        expect((result.Value as ObjectValue).Prototype).toBe(realm.Intrinsics['%StaticTypeError.prototype%']);
        expect(TypeDiagnosticOf(result.Value)).toMatchObject({ rule: 'rt-reference-permission', phase: 'static' });
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
  test(`importing Module checks unused forwarding (ref=${ref})`, async () => {
    const result = await observeModuleGraph({
      dep: declaration + 'export {g};',
      main: 'import {g} from "dep";' + wrapper,
    });
    if (ref) {
      expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
      expect(result.diagnostic).toBeUndefined();
    } else {
      expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
        diagnostic: { rule: 'rt-reference-permission', phase: 'static' } });
    }
  });
}
