import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import {
  Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf,
  CreateBuiltinFunction, CreateDataPropertyOrThrow, OrdinaryDefineOwnProperty,
  ToPropertyDescriptor, ToPropertyKey, IsAccessorDescriptor, ObjectValue, Value,
  X, type OrdinaryObject,
} from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/legacy-array-accessors.json', import.meta.url), 'utf8')) as {
  cases: { name: string; steps: { source: string; expected: Record<string, unknown>; messageIncludes?: string }[] }[];
};
for (const { name, steps } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const pop = realm.pushTopContext();
    try {
      const define = CreateBuiltinFunction(function* ([object, key = Value.undefined, attributes = Value.undefined]) {
        const property = X(yield* ToPropertyKey(key));
        const desc = X(yield* ToPropertyDescriptor(attributes));
        expect(object).toBeInstanceOf(ObjectValue);
        expect(IsAccessorDescriptor(desc)).toBe(true);
        expect((object as ObjectValue).properties.has(property)).toBe(true);
        // Deliberately bypass the Array's accessor prohibition to retain tests
        // for damaged legacy backing. This helper is never a language feature.
        expect(X(OrdinaryDefineOwnProperty(object as OrdinaryObject, property, desc))).toBe(Value.true);
        return object;
      }, 3, Value('defineLegacyAccessor'), []);
      X(CreateDataPropertyOrThrow(realm.GlobalObject, Value('defineLegacyAccessor'), define));
    } finally {
      pop?.();
    }
    try {
      for (const { source, expected, messageIncludes } of steps) {
        let scriptBodies = 0;
        agent.hostDefinedOptions.onNodeEvaluation = (node) => {
          if (node.type === 'ScriptBody') scriptBodies += 1;
        };
        const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
        const diagnostic = TypeDiagnosticOf(completion.Value);
        const errorClass = completion.Type === 'throw' ? nativeErrorClass(completion.Value, realm) : undefined;
        expect({ completion: completion.Type, bodyEntered: scriptBodies > 0, scriptBodies, errorClass, diagnostic,
          value: completion.Type === 'normal' ? (completion.Value as { stringValue?: () => string })?.stringValue?.() : undefined }).toMatchObject(expected);
        if (messageIncludes) expect((completion.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString).toContain(messageIncludes);
        if (!expected.errorClass) expect(errorClass).toBeUndefined();
        if (!expected.diagnostic) expect(diagnostic).toBeUndefined();
        expect(agent.jobQueue?.length ?? 0).toBe(0);
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}
