import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/range-results.json', import.meta.url), 'utf8')) as {
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

test('Module rejects unused range result mismatch before body entry', async () => {
  const result = await observeModuleGraph({ main: 'function bad(r:ClosedRange.<uint8>){const x:string=(r*r).start;}await 0;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
});

test('Module imports generic range result across await', async () => {
  const result = await observeModuleGraph({ main: 'import { take } from "dep";await 0;const r:ClosedRange.<uint64>=9007199254740993..=9007199254740995;const s=take.<uint64>(r);'
    + 'if(String(s.end)!=="9007199254740994")throw new Error("endpoint");',
  dep: 'export function take<T:type>(r:ClosedRange.<T>):RangeBounds.<T>{return r.take(2);}' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module replaced range method retains return boundary after await', async () => {
  const result = await observeModuleGraph({ main: 'function read(r:ClosedRange.<uint8>):RangeBounds.<uint8>{return r.take(2);}const r:ClosedRange.<uint8>=1..=3;'
    + 'r.take=()=>"wrong";await 0;read(r);' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module imported result supplies an endpoint contract', async () => {
  const result = await observeModuleGraph({ main: 'import { s } from "dep";function bad(){const x:string=s.start;}await 0;',
    dep: 'const r:ClosedRange.<uint8>=1..=3;export const s=r.take(2);' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
});

test('Module division publishes full result without invented endpoints', async () => {
  const result = await observeModuleGraph({ main: 'const a:ClosedRange.<float64>=1..=2;const b:ClosedRange.<float64>=-1..=1;await 0;const s=a/b;'
    + 'if(!s.isFull||s.start!==undefined||s.end!==undefined)throw new Error("full");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});
