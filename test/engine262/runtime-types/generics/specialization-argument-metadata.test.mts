import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/specialization-argument-metadata.json', import.meta.url), 'utf8')) as {
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

const producer = (valid: boolean): string => 'function identity(t:type):type{return t;}'
  + 'export function outer<T:type>(){function inner<U:type,W:type=identity(U)>(y:W){return "ok";}'
  + `const fn=inner.<T>;return fn(y:${valid ? '1' : '"bad"'});}`;
for (const valid of [false, true]) {
  test(`imported stored named consumer (${valid})`, async () => {
    const result = await observeModuleGraph({ dep: producer(valid),
      main: 'import {outer} from "dep";outer.<uint8>();',
    });
    expect(result).toMatchObject(valid
      ? { status: 'fulfilled', bodyEntries: ['dep', 'main'] }
      : { status: 'rejected', bodyEntries: ['dep'], errorClass: 'StaticTypeError',
        diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'pre-evaluation' } });
    if (valid) expect(result.diagnostic).toBeUndefined();
  });
  test(`generated Function stored named consumer (${valid})`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const source = producer(valid).replace('export ', '') + 'return outer.<uint8>();';
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(
      `let outcome="missed";try{outcome=Function(${JSON.stringify(source)})();}catch(e){outcome=e.name;}outcome;`,
    ));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue(): string }).stringValue()).toBe(valid ? 'ok' : 'StaticTypeError');
  });
}
