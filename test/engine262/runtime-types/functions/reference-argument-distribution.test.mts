import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/reference-argument-distribution.json', import.meta.url), 'utf8')) as {
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
        const errorClass = completion.Type === 'throw' ? nativeErrorClass(completion.Value, realm) : undefined;
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

for (const stored of [false, true]) {
  test(`module reference argument distribution (stored=${stored})`, async () => {
    const result = await observeModuleGraph({
      dep: 'export function f<T:type>(ref x:T,y:T):void{x=y;}',
      main: 'import {f} from "dep";let x:uint8=1;'
        + (stored ? 'const fn=f.<uint8>;fn(ref x,y:2);' : 'f.<uint8>(ref x,y:2);')
        + 'if(x!==uint8(2))throw new Error("write lost");',
    });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    expect(result.diagnostic).toBeUndefined();
  });
  test(`generated Function reference argument distribution (stored=${stored})`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const source = 'function f<T:type>(ref x:T,y:T):void{x=y;}let x:uint8=1;'
      + (stored ? 'const fn=f.<uint8>;fn(ref x,y:2);' : 'f.<uint8>(ref x,y:2);')
      + 'return String(x);';
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`Function(${JSON.stringify(source)})();`));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe('2');
  });
}
