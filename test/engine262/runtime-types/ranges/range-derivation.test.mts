import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/range-derivation.json', import.meta.url), 'utf8')) as {
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
        const errorClass = completion.Type === 'throw' && completion.Value instanceof ObjectValue
          ? ['Error', 'SyntaxError', 'TypeError', 'RangeError', 'ReferenceError', 'StaticTypeError'].find((kind) =>
            completion.Value.Prototype === realm.Intrinsics[`%${kind}.prototype%`]) : undefined;
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

test('Module typed intersection retains endpoints across await', async () => {
  const result = await observeModuleGraph({ main: 'const a:Range.<uint8>=0..<10;const b:Range.<uint8>=2..<8;await 0;'
    + 'const r=a.intersect(b);if(!(r.start is uint8)||Reflect.typeOf(r)!==(type Range.<uint8>))throw new Error("domain");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module failed comparison stays a body-time failure', async () => {
  const result = await observeModuleGraph({ main: 'class P{operator<(o){throw new Error("order");}}'
    + '(new P()..<new P()).intersect(new P()..<new P());' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'Error' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module repeated generic full selection retains each domain', async () => {
  const result = await observeModuleGraph({ main: 'function f<T:type>():RangeFull.<T>{const a:RangeFull.<T>=(..);return a.intersect(a);}await 0;'
    + 'if(Reflect.typeOf(f.<uint8>())!==(type RangeFull.<uint8>)||Reflect.typeOf(f.<number>())!==(type RangeFull.<number>))throw new Error("domain");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module wide selection survives metadata snapshot and materialization', async () => {
  const result = await observeModuleGraph({ main: 'type M={mark:RangeBounds.<uint64>};meta M{default={mark:..};subtype(a,b){return true;}}'
    + 'const a:ClosedRange.<uint64>=9007199254740993..=9007199254741000;'
    + 'const b:ClosedRange.<uint64>=9007199254740995..=9007199254741001;await 0;'
    + 'const T=Reflect.makeType({kind:"parameterized",base:uint8,metadata:{mark:a.intersect(b)}});'
    + 'const r=Reflect.getReflection(T).metadata.mark;if(String(r.start)!=="9007199254740995"||!(r.start is uint64))throw new Error("endpoint");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});
