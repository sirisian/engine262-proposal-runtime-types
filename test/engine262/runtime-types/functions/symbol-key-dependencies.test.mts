import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { nativeErrorClass } from '../error-observer.mts';
import {
  Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf,
} from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/symbol-key-dependencies.json', import.meta.url), 'utf8')) as {
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

for (const prefix of ['', 'await 0;']) {
  test(`Module fresh key object admission (${prefix || 'sync'})`, async () => {
    const result = await observeModuleGraph({ main: `${prefix}const k=Symbol("p");const h={[k]:uint8(1)};if(String(h[k])!=="1")throw new Error("wrong key");` });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}

test('Module imported key admission retains exporter identity', async () => {
  const result = await observeModuleGraph({ dep: 'export const k=Symbol("p");',
    main: 'import {k} from "dep";const h={[k]:uint8(1)};if(String(h[k])!=="1")throw new Error("wrong key");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module re-exported key remains distinct from a same-description local key', async () => {
  const result = await observeModuleGraph({ dep: 'export const k=Symbol("p");', bridge: 'export {k as key} from "dep";',
    main: 'import {key as k} from "bridge";const own=Symbol("p");const h={[k]:uint8(1),[own]:uint8(2)};if(String(h[k])+String(h[own])!=="12")throw new Error("wrong keys");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'bridge', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module direct eval follows initialized imported key', async () => {
  const result = await observeModuleGraph({ dep: 'export const k=Symbol("p");',
    main: 'import {k} from "dep";eval("const h={[k]:uint8(1)};if(String(h[k])!==\\"1\\")throw new Error(\\"wrong key\\");");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});
