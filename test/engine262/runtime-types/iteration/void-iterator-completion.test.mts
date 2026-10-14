import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/void-iterator-completion.json', import.meta.url), 'utf8')) as {
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

test('Module observes async void completion', async () => {
  const result = await observeModuleGraph({ main: 'async function* f():uint8{}const b=await f().next();if(b.done!==true)throw new Error("done");' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module imports a captured completion projection', async () => {
  const result = await observeModuleGraph({ main: 'import {make} from "dep";const f=make.<void>();await 0;const raw:any={value:"terminal",done:true};const b=f(raw);if(b.value!=="terminal")throw new Error("value");',
    dep: 'export function make<R:type>(){return (x:IteratorResult.<uint8,R>)=>x;}' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module retains concrete completion refusal before entry', async () => {
  const result = await observeModuleGraph({ main: 'const x:IteratorResult.<uint8,undefined>={value:"wrong",done:true};await 0;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
});

test('Module retains yielded-value receiving check after await', async () => {
  const result = await observeModuleGraph({ main: 'await 0;const raw:any={value:"wrong",done:false};const x:IteratorResult.<uint8,void>=raw;' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
  expect(result.diagnostic).toBeUndefined();
});
