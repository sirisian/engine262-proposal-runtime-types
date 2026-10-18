import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/nongeneric-argument-identity.json', import.meta.url), 'utf8')) as {
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

const factory = 'export function make(){class C{}return type C;}';
for (const prefix of ['', 'await 0;']) {
  test(`Module exported nongeneric arguments (${prefix || 'sync'})`, async () => {
    const { observeModuleGraph } = await import('../module-observer.mts');
    const result = await observeModuleGraph({ dep: factory,
      main: prefix + 'import {make} from "dep";class P<T:type>{}const A=make(),B=make();const x=P.<P.<A>>,y=P.<P.<B>>,z=P.<P.<A>>;if(x===y||x!==z||Reflect.isAssignable(A,B))throw new Error("identity");' });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}

test('Module re-exported forward class arguments', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export function make(){type Early=C;class C{}return {early:Early,late:type C};}',
    bridge: 'export {make} from "dep";',
    main: 'import {make} from "bridge";class P<T:type>{}const a=make(),b=make();const x=P.<a.early>,y=P.<a.late>,z=P.<b.early>;if(x!==y||x===z)throw new Error("identity");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'bridge', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module anonymous default class keeps evaluated identity', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export default class {}', other: 'export default class {}',
    main: 'import A from "dep";import B from "other";class P<T:type>{}if(Reflect.isAssignable(A,B)||(type P.<A>)===(type P.<B>))throw new Error("identity");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'other', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});
