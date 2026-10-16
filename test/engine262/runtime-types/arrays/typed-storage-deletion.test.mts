import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, type Value as EngineValue, type ObjectValue as EngineObjectValue } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/typed-storage-deletion.json', import.meta.url), 'utf8')) as {
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

test('Module imported storage rejects deletion and permits pop', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export const a:[].<uint8>=[1,2];',
    main: 'import {a} from "dep";await 0;const raw:any=a;let error="";try{Reflect.deleteProperty(raw,"0");}catch(e){error=e.name;}if(error!=="TypeError"||raw.pop()!==2||raw.length!==1)throw new Error("bad removal");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module failed removal keeps the initialized tail', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({ main: 'const a:[].<uint8>=[1,2];const raw:any=a;Object.defineProperty(raw,"length",{writable:false});try{raw.pop();}catch(e){}if(raw.length!==2||!Object.hasOwn(raw,"1"))throw new Error("hole");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('a cross-realm intrinsic removes the receiving typed tail', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const selected = EnsureCompletion(foreign.evaluateScriptSkipDebugger('Array.prototype.shift;'));
  expect(selected.Type).toBe('normal');
  const realm = new ManagedRealm();
  X(CreateDataPropertyOrThrow(realm.GlobalObject, Value('foreignShift'), selected.Value as EngineValue));
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const a:[].<uint8>=[1,2];const raw:any=a;String(foreignShift.call(raw))+"/"+raw.join(",");'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('1/2');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} source cannot delete typed storage`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'const a:[].<uint8>=[7];const raw:any=a;let error="";try{delete raw[0];}catch(e){error=e.name;}'
      + (mode === 'Function' ? 'return ' : '') + 'error+"/"+Object.hasOwn(raw,"0");';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('TypeError/true');
    expect(agent.jobQueue?.length ?? 0).toBe(0);
  });
}

test('a legacy sparse fixture cannot delete a surviving typed position', async () => {
  const { Value, ObjectValue } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const a:[].<uint8>=[1,2,3];const raw:any=a;raw;'));
  expect(result.Type).toBe('normal');
  expect(result.Value).toBeInstanceOf(ObjectValue);
  // Host-created damaged storage, not an endorsed sparse admission path.
  (result.Value as EngineObjectValue).properties.delete(Value('1'));
  const observed = EnsureCompletion(realm.evaluateScriptSkipDebugger('let error="";try{raw.shift();}catch(e){error=e.name;}error+"/"+raw.length+"/"+Object.hasOwn(raw,"0");'));
  expect(observed.Type).toBe('normal');
  expect((observed.Value as { stringValue: () => string }).stringValue()).toBe('TypeError/3/true');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});

test('feature-disabled Array deletion retains ordinary behavior', () => {
  const agent = new Agent();
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const a=[7];String(Reflect.deleteProperty(a,"0"))+"/"+a.length+"/"+Object.hasOwn(a,"0");'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('true/1/false');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});

test('index classification preserves the distinction between zero and negative-zero keys', async () => {
  const { isArrayIndex, isIntegerIndex, Value } = await import('#self');
  const agent = new Agent();
  setSurroundingAgent(agent);
  new ManagedRealm();
  for (const [key, array, integer] of [
    ['0', true, true], ['-0', false, false], ['01', false, false], ['1.0', false, false],
    ['4294967294', true, true], ['4294967295', false, true], ['9007199254740991', false, true],
    ['9007199254740992', false, false],
  ] as const) {
    expect([isArrayIndex(Value(key)), isIntegerIndex(Value(key))], key).toEqual([array, integer]);
  }
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const a=[];a["-0"]=7;const before=a.length;a.length=0;String(before)+"/"+a["-0"]+"/"+Object.keys(a).join(",");'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('0/7/-0');
});
