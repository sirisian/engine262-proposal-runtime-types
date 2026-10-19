import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/generic-callable-publication.json', import.meta.url), 'utf8')) as {
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

const ordinary = 'export function make(){class P<T:type>{}function f<U:type>(v:U){return new P.<U>();}return f;}';
const captured = 'export function make(){class P<N:uint32>{}function f<T:type>(v:T):any{return v;}function f<uint.<const N>>(v:uint.<N>){return new P.<N>();}return f;}';
for (const [name, dep, main] of [
  ['ordinary generic result', ordinary, 'import {make} from "dep";const f=make();f.<uint8>(1);f.<string>("x");'],
  ['captured case result', captured, 'import {make} from "dep";const f=make();const a=f.<uint.<12>>;Reflect.typeOf(a);a(1);'],
  ['aliased factory result', ordinary, 'import {make as factory} from "dep";const f=factory();const g=f;g.<uint8>(1);'],
]) {
  test(`Module ${name}`, async () => {
    const { observeModuleGraph } = await import('../module-observer.mts');
    const result = await observeModuleGraph({ dep, main });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}

test('Module incompatible generic replacement fails before either body', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'class P<T:type>{}function f<T:type>(v:T):string{return "owner";}function f<uint8>(v:uint8):P.<uint8>{return new P.<uint8>();}export {f};',
    main: 'import {f} from "dep";f.<uint8>(1);',
  });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_SPECIALIZATION_CONTRACT', phase: 'static' } });
});
