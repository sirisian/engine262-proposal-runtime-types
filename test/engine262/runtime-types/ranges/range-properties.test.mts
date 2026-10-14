import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/range-properties.json', import.meta.url), 'utf8')) as {
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

test('Module rejects an unused range property mismatch before body entry', async () => {
  const result = await observeModuleGraph({ main: 'function bad(r:ClosedRange.<uint8>){const x:string=r.start;}await 0;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
});

test('Module imported generic reader preserves endpoint identity across await', async () => {
  const result = await observeModuleGraph({ main: 'import { read } from "dep";await 0;const r:ClosedRange.<uint64>=9007199254740993..=9007199254740995;const x=read.<uint64>(r);'
    + 'if(String(x)!=="9007199254740993")throw new Error("endpoint");',
  dep: 'export function read<T:type>(r:ClosedRange.<T>):T{return r.start;}' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module range getter replacement retains return admission', async () => {
  const result = await observeModuleGraph({ main: 'function read(r:ClosedRange.<uint8>):uint8{return r.start;}const r:ClosedRange.<uint8>=1..=2;'
    + 'Object.defineProperty(r,"start",{get(){return "wrong";}});await 0;read(r);' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module imports an extracted endpoint contract across await', async () => {
  const result = await observeModuleGraph({ main: 'import { endpoint } from "dep";await 0;const x:uint64=endpoint;'
    + 'if(String(x)!=="9007199254740993")throw new Error("endpoint");',
  dep: 'const r:ClosedRange.<uint64>=9007199254740993..=9007199254740995;export const {start:endpoint}=r;' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module checks a replaced getter before completing an extracted binding', async () => {
  const result = await observeModuleGraph({ main: 'const r:ClosedRange.<uint8>=1..=2;'
    + 'Object.defineProperty(r,"start",{get(){return "wrong";}});await 0;const {start:x}=r;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});
