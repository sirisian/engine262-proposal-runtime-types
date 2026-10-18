import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { nativeErrorClass } from '../error-observer.mts';
import {
  Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf,
} from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/generic-result-dependencies.json', import.meta.url), 'utf8')) as {
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

const factory = 'function make(n:uint8){class P<T:type>{n:uint8=n;constructor(v:string){}}return(v:any)=>{const p:P.<uint8>=v;return p;};}';
const consume = 'const a=make(1),b=make(2);function choose(){return b("x");}const h={p:choose()};if(String(h.p.n)!=="2")throw new Error("wrong family");';
for (const prefix of ['', 'await 0;']) {
  test(`Module generic local result (${prefix || 'sync'})`, async () => {
    const result = await observeModuleGraph({ main: prefix + factory + consume });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}

test('Module exported factory preserves captured family', async () => {
  const result = await observeModuleGraph({ dep: 'export ' + factory,
    main: 'import {make} from "dep";' + consume });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module re-exported factory preserves captured family', async () => {
  const result = await observeModuleGraph({ dep: 'export ' + factory, bridge: 'export {make} from "dep";',
    main: 'import {make} from "bridge";' + consume });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'bridge', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module exported closure retains exporter activation', async () => {
  const result = await observeModuleGraph({ dep: factory + 'export const f=make(7);',
    main: 'import {f} from "dep";const h={p:f("x")};if(String(h.p.n)!=="7")throw new Error("wrong family");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});
