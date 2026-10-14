import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, CreateDataPropertyOrThrow, Value, X } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/named-intrinsic-routing.json', import.meta.url), 'utf8')) as {
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

test('Module routes a named range call after import and await', async () => {
  const result = await observeModuleGraph({ main: 'import { make } from "dep";await 0;const r=make();if(String(r.step(by:2).toArray())!=="0,2,4")throw new Error("routing");', dep: 'export function make(){return 0..<5;}' });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('Module retains static rejection of unknown intrinsic names', async () => {
  const result = await observeModuleGraph({ main: 'const r=0..<5;r.step(wrong:2);' });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError' });
});

test('a foreign intrinsic retains its parameter declaration after borrowing', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const selected = EnsureCompletion(foreign.evaluateScriptSkipDebugger('(0..<1).step;'));
  expect(selected.Type).toBe('normal');
  const realm = new ManagedRealm();
  X(CreateDataPropertyOrThrow(realm.GlobalObject, Value('foreignStep'), selected.Value as Value));
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const r:any=0..<5;Object.getPrototypeOf(r).step=foreignStep;String(r.step(by:2).toArray());'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('0,2,4');
});
