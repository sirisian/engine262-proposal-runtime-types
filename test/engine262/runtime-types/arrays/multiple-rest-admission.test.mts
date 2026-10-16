import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, type Value as EngineValue } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/multiple-rest-admission.json', import.meta.url), 'utf8')) as {
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

test('Module imported finite rest extent', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export type T=[...[].<number>,...[2].<string>,...[].<boolean>];',
    main: 'import {T} from "dep";await 0;const raw:any=[1,"s",true];if(raw is T)throw new Error("lost extent");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

test('cross-realm membership keeps collected extent', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const selected = EnsureCompletion(foreign.evaluateScriptSkipDebugger('[1,"s",true];'));
  expect(selected.Type).toBe('normal');
  const realm = new ManagedRealm();
  X(CreateDataPropertyOrThrow(realm.GlobalObject, Value('raw'), selected.Value as EngineValue));
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('String(raw is [...[].<number>,...[2].<string>,...[].<boolean>]);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('false');
  expect(agent.jobQueue?.length ?? 0).toBe(0);
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} source respects collected extent`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'const raw:any=[1,"s",true];'
      + (mode === 'Function' ? 'return ' : '') + 'String(raw is [...[].<number>,...[2].<string>,...[].<boolean>]);';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('false');
    expect(agent.jobQueue?.length ?? 0).toBe(0);
  });
}

test('feature-disabled ordinary array remains growable', () => {
  const agent = new Agent();
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const a=[];a.push("s",true);a.join(",");'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('s,true');
});
