import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, CreateDataPropertyOrThrow, Value, X } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/tuple-callable-admission.json', import.meta.url), 'utf8')) as {
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


test('Module imports a generic function into a tuple after await', async () => {
  const result = await observeModuleGraph({ main: 'import { make } from "dep";await 0;const a:[()=>string]=[make];const f:any=a[0];if(typeof f()!=="string")throw new Error("output");', dep: 'export function make<T:type>():T{const v:any=1;return v;}' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module rejects an element where before publication', async () => {
  const result = await observeModuleGraph({ main: 'function id<T:type>(x:T):T where T===uint8{return x;}const raw:any=[id];await 0;const a:[(x:string)=>string]=raw;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module rejects an incompatible known generic element before entry', async () => {
  const result = await observeModuleGraph({ main: 'function id<T:type extends number>(x:T):T{return x;}const a:[(x:string)=>string]=[id];' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
});

for (const [kind, source, program] of [
  ['native', '(0..<1).map;', 'const r:any=1..<3;const a:[(callback:(value:any,index:uint64)=>string)=>Iterator.<string,undefined,any>]=[foreignFunction];const cb:any=v=>v;const f:any=a[0];const it:any=f.call(r,cb);String(f===foreignFunction.<string>)+"/"+typeof it.next().value;'],
  ['source', 'function make<T:type>():T{const value:any=1;return value;}make;', 'const a:[()=>string]=[foreignFunction];const f:any=a[0];String(f===foreignFunction.<string>)+"/"+typeof f();'],
]) {
  test(`${kind} tuple element reuses a foreign specialization`, () => {
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
    expect(agent.jobQueue?.length ?? 0).toBe(0);
  });
}

for (const mode of ['Function', 'eval']) {
  test(`${mode} source retains the element specialization`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'function id<T:type>(x:T):T{return x;}const a:[(x:string)=>string]=[id];'
      + (mode === 'Function' ? 'return ' : '') + 'String(a[0]===id.<string>);';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('true');
    expect(agent.jobQueue?.length ?? 0).toBe(0);
  });
}
