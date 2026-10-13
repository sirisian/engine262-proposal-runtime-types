import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/range-products.json', import.meta.url), 'utf8')) as {
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
      }
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

test('Module multiplication preserves wide types across await', async () => {
  const result = await observeModuleGraph({ main: 'import { a,b } from "dep";await 0;const c=a*b;'
    + 'if(String(c.start)!=="9007199254740993"||!(c.end is uint64))throw new Error("product");',
  dep: 'export const a:ClosedRange.<uint64>=9007199254740993..=9007199254740995;export const b:ClosedRange.<uint64>=1..=1;' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module integer division fails without truncating', async () => {
  const result = await observeModuleGraph({ main: 'const a:ClosedRange.<uint8>=1..=1;const b:ClosedRange.<uint8>=2..=2;await 0;const c=a/b;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'RangeError' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module float128 division encloses the exact quotient', async () => {
  const result = await observeModuleGraph({ main: 'import { a,b } from "dep";await 0;const c=a/b;'
    + 'if(!c.contains(rational64(1,3))||c.start===c.end||!(c.start is float128))throw new Error("enclosure");',
  dep: 'export const a:ClosedRange.<float128>=1..=1;export const b:ClosedRange.<float128>=3..=3;' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});
