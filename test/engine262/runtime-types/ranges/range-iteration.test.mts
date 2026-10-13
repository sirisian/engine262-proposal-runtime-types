import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/range-iteration.json', import.meta.url), 'utf8')) as {
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

test('Module numeric iterator preserves wide items across await', async () => {
  const result = await observeModuleGraph({ main: 'const r:ClosedRange.<uint64>=9007199254740993..=9007199254740994;'
    + 'const it=r[Symbol.iterator]();if(String(it.next().value)!=="9007199254740993")throw new Error("first");await 0;'
    + 'const v=it.next().value;if(String(v)!=="9007199254740994"||!(v is uint64)||!it.next().done)throw new Error("second");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module numeric overflow is a body-time RangeError', async () => {
  const result = await observeModuleGraph({ main: 'const r:RangeFrom.<uint8>=255..;const it=r[Symbol.iterator]();await 0;it.next();it.next();' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'RangeError' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module generic numeric iterators retain distinct specializations', async () => {
  const result = await observeModuleGraph({ main: 'function make<T:type>(start:T,end:T):Range.<T>{return start..<end;}await 0;'
    + 'const a=make.<uint8>(0,3)[Symbol.iterator]().next().value;const b=make.<float32>(0,3).reverse().next().value;'
    + 'if(!(a is uint8)||!(b is float32)||String(b)!=="2")throw new Error("domain");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module imports preserve iterator state across its failure', async () => {
  const result = await observeModuleGraph({ main: 'import { it } from "dep";await 0;it.next();let failed=false;'
    + 'try{it.next();}catch(e){failed=e instanceof RangeError;}if(!failed||!it.next().done)throw new Error("state");',
  dep: 'const r:RangeFrom.<uint8>=255..;export const it=r[Symbol.iterator]();' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});
