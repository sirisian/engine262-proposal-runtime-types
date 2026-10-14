import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/range-flatmap.json', import.meta.url), 'utf8')) as {
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

test('Module rejects flattened item mismatch before entry', async () => {
  const result = await observeModuleGraph({ main: 'function bad(r:ClosedRange.<uint8>){const x:string=r.flatMap(function*(v){yield v;}).next().value;}await 0;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
});

test('Module rejects ineligible callback before entry', async () => {
  const result = await observeModuleGraph({ main: 'function bad(r:ClosedRange.<uint8>){r.flatMap(v=>"text");}await 0;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { code: 'RT_BUILTIN_ARGUMENT', phase: 'static' } });
});

test('Module keeps flattened result across import and await', async () => {
  const result = await observeModuleGraph({ main: 'import { read } from "dep";await 0;const r:ClosedRange.<uint8>=1..=2;const it=read(r);const v:uint8|undefined=it[Symbol.iterator]().next().value;if(v!==1)throw new Error("item");',
    dep: 'export function read(r:RangeBounds.<uint8>){return r.flatMap(function*(v){yield v;return "terminal";});}' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module retains callback entry check after replacement and await', async () => {
  const result = await observeModuleGraph({ main: 'let saved:any;const r:ClosedRange.<uint8>=1..=1;r.flatMap=function(cb){saved=cb;};r.flatMap((v,i)=>[v]);await 0;saved("wrong",0);' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});
