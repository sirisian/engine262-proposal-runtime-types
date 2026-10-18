import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/generic-conversion-registration.json', import.meta.url), 'utf8')) as {
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

test('Module target specialization retains the declaration environment', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export let seen="";export class C<T:type>{operator C(v:T){seen=String(v);return new C.<T>();}}',
    main: 'import {C,seen} from "dep";const raw:any="module";const c:C.<string>=raw;await 0;if(seen!=="module"||!(c instanceof C.<string>))throw new Error("wrong specialization");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} registers the concrete inbound conversion`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'let seen="";class C<T:type>{operator C(v:T){seen=String(v);return new C.<T>();}}const raw:any="s";const c:C.<string>=raw;'
      + (mode === 'Function' ? 'return ' : '') + 'seen+"/"+String(c instanceof C.<string>);';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('s/true');
  });
}

test('foreign input reaches the concrete inbound operator', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const value = EnsureCompletion(foreign.evaluateScriptSkipDebugger('({ value: "foreign" });'));
  expect(value.Type).toBe('normal');
  const local = new ManagedRealm();
  X(CreateDataPropertyOrThrow(local.GlobalObject, Value('foreignValue'), value.Value as import('#self').Value));
  const result = EnsureCompletion(local.evaluateScriptSkipDebugger('let seen="";class C<T:type>{operator C(v:any){seen=v.value;return new C.<T>();}}const c:C.<string>=foreignValue;seen+"/"+String(c instanceof C.<string>);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('foreign/true');
});

test('feature-disabled class static initialization remains ordinary', () => {
  const agent = new Agent();
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('let effects=0;class C{static value=++effects;}String(effects);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('1');
});


test('foreign target materializes in its declaration realm and restores the caller realm', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const target = EnsureCompletion(foreign.evaluateScriptSkipDebugger('class C<T:type>{static marker=[];operator C(v:T){return new C.<T>();}}C;'));
  expect(target.Type).toBe('normal');
  const local = new ManagedRealm();
  X(CreateDataPropertyOrThrow(local.GlobalObject, Value('Foreign'), target.Value as import('#self').Value));
  X(CreateDataPropertyOrThrow(local.GlobalObject, Value('ForeignArray'), foreign.Intrinsics['%Array%']));
  const result = EnsureCompletion(local.evaluateScriptSkipDebugger('const raw:any="s";const c:Foreign.<string>=raw;const held:any=Foreign.<string>;String(held.marker instanceof ForeignArray)+"/"+String(held.marker instanceof Array)+"/"+String([] instanceof Array);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('true/false/true');
});
