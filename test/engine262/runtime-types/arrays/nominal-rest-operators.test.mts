import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/nominal-rest-operators.json', import.meta.url), 'utf8')) as {
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

test('Module inbound rest conversion retains its selected count across await', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export let calls=0;export class C{operator C(v:any){calls++;return new C();}}',
    main: 'import {C,calls} from "dep";type T=[...[].<C>,...[1].<string>,...[].<boolean>];const raw:any=[1,"s"];const t:T=raw;const x:any=t;await 0;if(calls!==1||!(x is T))throw new Error("bad conversion");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} uses the selected inbound operator plan`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'let calls=0;class C{operator C(v:any){calls++;return new C();}}type T=[...[].<C>,...[1].<string>,...[].<boolean>];const raw:any=[1,"s"];const t:T=raw;const x:any=t;'
      + (mode === 'Function' ? 'return ' : '') + 'calls+"/"+String(x is T);';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('1/true');
  });
}

test('foreign source array uses the receiving inbound operator and backing', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const value = EnsureCompletion(foreign.evaluateScriptSkipDebugger('[1,"s"];'));
  expect(value.Type).toBe('normal');
  const local = new ManagedRealm();
  X(CreateDataPropertyOrThrow(local.GlobalObject, Value('foreignArray'), value.Value as import('#self').Value));
  const result = EnsureCompletion(local.evaluateScriptSkipDebugger('let calls=0;class C{operator C(v:any){calls++;return new C();}}type T=[...[].<C>,...[1].<string>,...[].<boolean>];const t:T=foreignArray;const x:any=t;calls+"/"+String(x is T)+"/"+String(x===foreignArray)+"/"+String(Reflect.setPrototypeOf(x[0],null));'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('1/true/false/false');
});

test('feature-disabled movement retains ordinary class identity', () => {
  const agent = new Agent();
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('let calls=0;class C{constructor(v){calls++;}}const child=new C(1);const raw=[child];raw.unshift(2);calls+"/"+String(raw[1]===child);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('1/true');
});
