import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import {
  Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf,
  Call, Value, ObjectValue, skipDebugger, Get, X, LookupClassType, Descriptor,
  OrdinaryObjectCreate, OrdinaryDefineOwnProperty, OrdinaryDelete, CreateDataPropertyOrThrow,
  RetainPropertyResult, ForwardResultDependency, InstantiateReturnDependency,
  type TypeObject, type NormalCompletion, type Value as EngineValue, type FunctionObject,
} from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/aggregate-component-dependencies.json', import.meta.url), 'utf8')) as {
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

// These tests use an actually admitted call result. The inspected class record
// supplies the test's independently known expected target, never engine admission.
function fixture() {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const producer = EnsureCompletion(realm.evaluateScriptSkipDebugger(
    'function make(){class P{tag:string="p";constructor(v:string){}}return()=>{const p:P="x";return p;};}make();',
  ));
  expect(producer.Type).toBe('normal');
  const pop = realm.pushTopContext();
  const checked = EnsureCompletion(skipDebugger(Call(producer.Value as EngineValue, Value.undefined, [])));
  expect(checked.Type).toBe('normal');
  const ctor = X(Get(checked.Value as ObjectValue, Value('constructor')));
  const record = (LookupClassType(ctor as ObjectValue) as TypeObject).TypeRecord;
  if (record.Kind !== 'nominal') throw new Error('fixture must establish a nominal contract');
  const symbolic = { ...record, Constructor: undefined };
  const holder = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataPropertyOrThrow(holder, Value('p'), checked.Value as EngineValue));
  RetainPropertyResult(holder, Value('p'), checked);
  const read = (object = holder) => {
    const result = EnsureCompletion(skipDebugger(Get(object, Value('p'))));
    expect(result.Type).toBe('normal');
    const target = InstantiateReturnDependency(symbolic, ForwardResultDependency(result, result));
    if (target.Kind !== 'nominal') throw new Error('component read must retain a nominal target');
    return target;
  };
  expect(read().Constructor).toBe(ctor);
  return { realm, producer, checked: checked as NormalCompletion<EngineValue>, ctor, symbolic, holder, read, pop };
}

for (const mode of ['attribute only', 'failed replacement', 'failed deletion', 'same value replacement', 'different value replacement', 'delete and recreate', 'inherited read', 'getter replacement']) {
  test(`component evidence: ${mode}`, () => {
    const f = fixture();
    try {
      if (mode === 'attribute only') {
        expect(X(OrdinaryDefineOwnProperty(f.holder, Value('p'), Descriptor({ Enumerable: Value.false })))).toBe(Value.true);
        expect(f.read().Constructor).toBe(f.ctor);
      } else if (mode === 'failed replacement' || mode === 'failed deletion') {
        expect(X(OrdinaryDefineOwnProperty(f.holder, Value('p'), Descriptor({ Writable: Value.false, Configurable: Value.false })))).toBe(Value.true);
        const result = mode === 'failed replacement'
          ? X(OrdinaryDefineOwnProperty(f.holder, Value('p'), Descriptor({ Value: Value(1) })))
          : X(OrdinaryDelete(f.holder, Value('p')));
        expect(result).toBe(Value.false);
        expect(f.read().Constructor).toBe(f.ctor);
      } else if (mode === 'same value replacement' || mode === 'different value replacement') {
        // The nonwritable SameValue fast path does not allocate a descriptor.
        if (mode === 'same value replacement') X(OrdinaryDefineOwnProperty(f.holder, Value('p'), Descriptor({ Writable: Value.false, Configurable: Value.false })));
        const value = mode === 'same value replacement' ? f.checked.Value : Value(1);
        expect(X(OrdinaryDefineOwnProperty(f.holder, Value('p'), Descriptor({ Value: value })))).toBe(Value.true);
        expect(f.read()).toBe(f.symbolic);
      } else if (mode === 'delete and recreate') {
        expect(X(OrdinaryDelete(f.holder, Value('p')))).toBe(Value.true);
        X(CreateDataPropertyOrThrow(f.holder, Value('p'), f.checked.Value));
        expect(f.read()).toBe(f.symbolic);
      } else if (mode === 'inherited read') {
        const child = OrdinaryObjectCreate(f.holder);
        expect(f.read(child).Constructor).toBe(f.ctor);
        X(CreateDataPropertyOrThrow(child, Value('p'), f.checked.Value));
        expect(f.read(child)).toBe(f.symbolic);
        expect(f.read().Constructor).toBe(f.ctor);
      } else {
        expect(X(OrdinaryDefineOwnProperty(f.holder, Value('p'), Descriptor({ Getter: f.producer.Value as FunctionObject })))).toBe(Value.true);
        expect(f.read().Constructor).toBe(f.ctor);
        // A missing getter must not revive the old data contribution.
        expect(X(OrdinaryDefineOwnProperty(f.holder, Value('p'), Descriptor({ Getter: Value.undefined })))).toBe(Value.true);
        expect(f.read()).toBe(f.symbolic);
      }
    } finally {
      f.pop?.();
    }
  });
}
