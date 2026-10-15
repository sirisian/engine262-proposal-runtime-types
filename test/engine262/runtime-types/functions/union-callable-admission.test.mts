import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, CreateDataPropertyOrThrow, Value, X } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/union-callable-admission.json', import.meta.url), 'utf8')) as {
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

test('Module imports a generic function and materializes its selected union result', async () => {
  const result = await observeModuleGraph({ main: 'import { make } from "dep";await 0;const f:(()=>string)|undefined=make;const g:any=f;if(typeof g()!=="string")throw new Error("output");', dep: 'export function make<T:type>():T{const v:any=1;return v;}' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module rejects a failed where before assignment succeeds', async () => {
  const result = await observeModuleGraph({ main: 'function id<T:type>(x:T):T where T===uint8{return x;}const erased:any=id;await 0;const f:((x:string)=>string)|undefined=erased;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module refuses an incompatible known generic bound before entry', async () => {
  const result = await observeModuleGraph({ main: 'function id<T:type extends number>(x:T):T{return x;}const f:((x:string)=>string)|undefined=id;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
});

for (const [kind, source, program] of [
  ['native', '(0..<1).map;', 'const r:any=1..<3;const f:((callback:(value:any,index:uint64)=>string)=>Iterator.<string,undefined,any>)|undefined=foreignFunction;const callback:any=v=>v;const it:any=f.call(r,callback);String(f===foreignFunction.<string>)+"/"+typeof it.next().value;'],
  ['source', 'function make<T:type>():T{const value:any=1;return value;}make;', 'const f:(()=>string)|undefined=foreignFunction;const g:any=f;String(f===foreignFunction.<string>)+"/"+typeof g();'],
]) {
  test(`${kind} union boundary reuses a foreign specialization`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const foreign = new ManagedRealm();
    const selected = EnsureCompletion(foreign.evaluateScriptSkipDebugger(source!));
    expect(selected.Type).toBe('normal');
    const realm = new ManagedRealm();
    X(CreateDataPropertyOrThrow(realm.GlobalObject, Value('foreignFunction'), selected.Value as Value));
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(program!));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('true/string');
  });
}
