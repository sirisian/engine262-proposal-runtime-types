import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, type Value as EngineValue } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/tuple-spread-defaults.json', import.meta.url), 'utf8')) as {
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

test('Module imported alias retains default generic context', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export type Tail<N:number>=[uint8=N];export const raw:any=[];',
    main: 'import {raw,Tail} from "dep";await 0;function f<N:number>(){const t:[...Tail.<7>]=raw;return t[0];}if(f.<300>()!==7||raw.length!==0)throw new Error("lost construction");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('cross-realm expanded default copy uses receiving Array prototype', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const selected = EnsureCompletion(foreign.evaluateScriptSkipDebugger('[];'));
  expect(selected.Type).toBe('normal');
  const realm = new ManagedRealm();
  X(CreateDataPropertyOrThrow(realm.GlobalObject, Value('raw'), selected.Value as EngineValue));
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const t:[...[number=3+4]]=raw;String(Object.getPrototypeOf(t)===Array.prototype)+"/"+t[0]+"/"+raw.length;'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('true/7/0');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} source completes a tuple-spread default`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'const raw:any=[];const t:[...[number=3+4]]=raw;'
      + (mode === 'Function' ? 'return ' : '') + 't[0]+"/"+raw.length;';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('7/0');
    expect(agent.jobQueue?.length ?? 0).toBe(0);
  });
}

test('feature-disabled ordinary array remains growable', () => {
  const agent = new Agent();
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const raw=[];const alias=raw;alias.push("s");String(alias===raw)+"/"+raw.join(",");'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('true/s');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});


test('expanded default formation obeys the step budget and restores it', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ typeEvaluationBudget: { steps: 100 } } as never);
  let entries = 0;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') entries += 1;
  };
  try {
    const failed = EnsureCompletion(realm.evaluateScriptSkipDebugger('type Tail=[number=(()=>{let n=0;for(let i=0;i<1000;i++)n++;return n;})()];type T=[...Tail];"ran";'));
    expect(failed.Type).toBe('throw');
    expect(entries).toBe(0);
    expect(TypeDiagnosticOf(failed.Value)).toMatchObject({ code: 'RT_TYPE_EVALUATION_LIMIT', phase: 'pre-evaluation' });
    const next = EnsureCompletion(realm.evaluateScriptSkipDebugger('const raw:any=[];const t:[...[number=3+4]]=raw;t.join(",");'));
    expect(next.Type).toBe('normal');
    expect((next.Value as { stringValue(): string }).stringValue()).toBe('7');
    expect(entries).toBe(1);
  } finally {
    delete agent.hostDefinedOptions.onNodeEvaluation;
  }
});
