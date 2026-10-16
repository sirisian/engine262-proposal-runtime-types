import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/defaulted-tuple-admission.json', import.meta.url), 'utf8')) as {
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

test('Module imported fully supplied tuple retains callable specialization', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export function id<T:type>(x:T):T{return x;}export const raw:any=[id,1];',
    main: 'import {raw,id} from "dep";await 0;const t:[(x:string)=>string,number=7]=raw;if(t[0]!==id.<string>)throw new Error("lost specialization");raw.pop();if(raw.length!==1)throw new Error("lost length domain");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('cross-realm pop uses defaulted tuple length domain', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const selected = EnsureCompletion(foreign.evaluateScriptSkipDebugger('Array.prototype.pop;'));
  expect(selected.Type).toBe('normal');
  const realm = new ManagedRealm();
  X(CreateDataPropertyOrThrow(realm.GlobalObject, Value('foreignPop'), selected.Value as Value));
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const raw:any=[1,2];const t:[number,number=7]=raw;String(foreignPop.call(raw))+"/"+raw.length;'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('2/1');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} source specializes supplied defaulted tuple`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'function id<T:type>(x:T):T{return x;}const raw:any=[id,1];const t:[(x:string)=>string,number=7]=raw;'
      + (mode === 'Function' ? 'return ' : '') + 'String(t[0]===id.<string>);';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('true');
    expect(agent.jobQueue?.length ?? 0).toBe(0);
  });
}

test('feature-disabled Array copies retain ordinary mutable storage', () => {
  const agent = new Agent();
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const raw=[1,2];const copy=raw.with(1,8);copy.push("x");copy.join(",");'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('1,8,x');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});
