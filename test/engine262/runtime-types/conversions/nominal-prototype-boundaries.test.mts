import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/nominal-prototype-boundaries.json', import.meta.url), 'utf8')) as {
  cases: { name: string; limits?: { steps?: number; records?: number; depth?: number }; steps: { source: string; expected: Record<string, unknown>; messageIncludes?: string }[] }[];
};
for (const { name, steps, limits } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm(limits ? { typeEvaluationBudget: limits } as never : undefined);
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
        expect(agent.jobQueue?.length ?? 0, 'promise jobs settle before the next observation').toBe(0);
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

test('Module class boundary survives an await and guards aliases', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export class C{}',
    main: 'import {C} from "dep";const raw:any=Object.create(C.prototype);const c:C=raw;await 0;if(Reflect.setPrototypeOf(raw,null)||!(raw is C))throw new Error("lost class");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} exact class boundary guards prototype mutation`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'class C{}const raw:any=Object.create(C.prototype);const c:C=raw;'
      + (mode === 'Function' ? 'return ' : '') + 'String(Reflect.setPrototypeOf(raw,null))+"/"+String(raw is C);';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('false/true');
  });
}

test('cross-realm ordinary instance retains the local class obligation', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const local = new ManagedRealm();
  const prototype = EnsureCompletion(local.evaluateScriptSkipDebugger('class C{}C.prototype;'));
  expect(prototype.Type).toBe('normal');
  const foreign = new ManagedRealm();
  X(CreateDataPropertyOrThrow(foreign.GlobalObject, Value('localPrototype'), prototype.Value as import('#self').Value));
  const value = EnsureCompletion(foreign.evaluateScriptSkipDebugger('Object.create(localPrototype);'));
  expect(value.Type).toBe('normal');
  X(CreateDataPropertyOrThrow(local.GlobalObject, Value('foreignValue'), value.Value as import('#self').Value));
  const result = EnsureCompletion(local.evaluateScriptSkipDebugger('const c:C=foreignValue;String(Reflect.setPrototypeOf(foreignValue,null))+"/"+String(foreignValue is C);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('false/true');
});

test('feature-disabled prototype mutation remains ordinary', () => {
  const agent = new Agent();
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('class C{}const c=new C();String(Reflect.setPrototypeOf(c,null));'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('true');
});
