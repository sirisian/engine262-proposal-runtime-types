import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/class-expression-bindings.json', import.meta.url), 'utf8')) as {
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

const factory = 'class P<T:type>{constructor(v:string){}}export function make(){const C=class {};return(v:any)=>{const p:P.<C>=v;return p;};}';
const rejectReplacement = 'const a=make(),b=make();const h={p:a("x")};function write(o:any){o.p=b("x");}write(h);let rejected=false;try{const p=h.p;}catch(e){if(!(e instanceof TypeError))throw e;rejected=true;}if(!rejected)throw new Error("identity");';
for (const prefix of ['', 'await 0;']) {
  test(`Module exported expression converter (${prefix || 'sync'})`, async () => {
    const { observeModuleGraph } = await import('../module-observer.mts');
    const result = await observeModuleGraph({ dep: factory,
      main: prefix + 'import {make} from "dep";' + rejectReplacement });
    expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
    expect(result.diagnostic).toBeUndefined();
  });
}

test('Module re-exported expression converter', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: factory.replace('const C=class {};', 'const C=(class Named{});const Alias=C;').replace('P.<C>=', 'P.<Alias>='),
    bridge: 'export {make} from "dep";',
    main: 'import {make} from "bridge";' + rejectReplacement,
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'bridge', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module exported immutable expression binding keeps same-family reuse', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export const C=class {};class P<T:type>{constructor(v:string){}}export const a=(v:any)=>{const p:P.<C>=v;return p;};export const b=(v:any)=>{const p:P.<C>=v;return p;};',
    main: 'import {a,b,C} from "dep";const h={p:a("x")};function write(o:any){o.p=b("x");}write(h);const p=h.p;if(Reflect.getReflection(Reflect.typeOf(a)).signatures[0].return.type!==Reflect.getReflection(Reflect.typeOf(b)).signatures[0].return.type)throw new Error("reuse");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});
