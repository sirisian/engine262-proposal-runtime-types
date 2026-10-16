import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/array-insertion-initialization.json', import.meta.url), 'utf8')) as {
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


test('Module indexed growth initializes imported storage', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export const a:[].<uint8>=[1];',
    main: 'import {a} from "dep";await 0;const raw:any=a;raw[2]=7;if(raw.join(",")!=="1,0,7")throw new Error("bad growth");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module supplied function insertion requires no default', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({ main: 'function f(){return 7;}const a:[].<()=>number>=[f];const raw:any=a;raw.unshift(f,f);if(raw.length!==3||raw[2]()!==7)throw new Error("bad insertion");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('a cross-realm intrinsic stages the receiving array tail', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const selected = EnsureCompletion(foreign.evaluateScriptSkipDebugger('Array.prototype.unshift;'));
  expect(selected.Type).toBe('normal');
  const realm = new ManagedRealm();
  X(CreateDataPropertyOrThrow(realm.GlobalObject, Value('foreignUnshift'), selected.Value as Value));
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const a:[].<uint8>=[1];const raw:any=a;foreignUnshift.call(raw,8,9);raw.join(",");'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('8,9,1');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} source initializes an indexed gap`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'const a:[].<uint8>=[1];const raw:any=a;raw[2]=7;'
      + (mode === 'Function' ? 'return ' : '') + 'raw.join(",");';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('1,0,7');
    expect(agent.jobQueue?.length ?? 0).toBe(0);
  });
}

for (const type of ['uint8', '()=>number']) {
  test(`a legacy missing own ${type} element still needs initialization`, async () => {
    const { Value, ObjectValue } = await import('#self');
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`const a:[].<${type}>=[${type === 'uint8' ? '7' : '()=>7'}];const raw:any=a;raw;`));
    expect(result.Type).toBe('normal');
    expect(result.Value).toBeInstanceOf(ObjectValue);
    // Host fixture: do not endorse program-visible deletion of typed storage.
    (result.Value as ObjectValue).properties.delete(Value('0'));
    const observed = EnsureCompletion(realm.evaluateScriptSkipDebugger('let error="none";try{Reflect.defineProperty(raw,"0",{});}catch(e){error=e.name;}error+"/"+String(raw[0])+"/"+Object.hasOwn(raw,"0");'));
    expect(observed.Type).toBe('normal');
    expect((observed.Value as { stringValue: () => string }).stringValue()).toBe(type === 'uint8' ? 'none/0/true' : 'TypeError/undefined/false');
    expect(agent.jobQueue?.length ?? 0).toBe(0);
  });
}
