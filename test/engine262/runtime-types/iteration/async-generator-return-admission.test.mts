import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/async-generator-return-admission.json', import.meta.url), 'utf8')) as {
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

test('Module captures an async generic request contract', async () => {
  const result = await observeModuleGraph({ main: 'import {make} from "dep";const it:any=make.<string>();await 0;let rejected=false;try{await it.return({});}catch(e){rejected=e instanceof TypeError;}if(rejected!==true)throw new Error("admission");if((await it.return("closed")).value!=="closed")throw new Error("drain");',
    dep: 'export async function* make<R:type>():AsyncGenerator.<uint8,R,void>{const value:any=undefined;return value;}' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module omitted close survives await and yielding finally', async () => {
  const result = await observeModuleGraph({ main: 'async function* make():AsyncGenerator.<uint8,string,void>{try{yield uint8(1);return "body";}finally{await 0;yield uint8(2);}}const it:any=make();await it.next();const first=await it.return();await 0;const last=await it.next();if(first.done!==false||first.value!==uint8(2)||last.done!==true||last.value!==undefined)throw new Error("close");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module rejects a resolved request mismatch after entry', async () => {
  const result = await observeModuleGraph({ main: 'async function* make():AsyncGenerator.<uint8,string,void>{return "body";}await make().return(Promise.resolve({}));' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});

test('Module rejects a known direct mismatch before entry', async () => {
  const result = await observeModuleGraph({ main: 'async function* make():AsyncGenerator.<uint8,string,void>{return "body";}await make().return(5);' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
});
