import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/conversion-results.json', import.meta.url), 'utf8')) as {
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

test('imported conversion returns its declared numeric representation', async () => {
  const { observeModuleGraph } = await import('../module-observer.mts');
  const result = await observeModuleGraph({
    dep: 'export class S{operator uint8(){const x:any=7;return x;}}',
    main: 'import {S} from "dep";const raw:any=new S();const n:uint8=raw;const result:any=n;await 0;if(!(result is uint8))throw new Error("wrong result");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.diagnostic).toBeUndefined();
});

for (const mode of ['Function', 'eval']) {
  test(`${mode} checks the conversion result`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    const body = 'class S{operator uint8(){const x:any=7;return x;}}const raw:any=new S();const n:uint8=raw;'
      + (mode === 'Function' ? 'return ' : '') + 'String(n is uint8);';
    const source = mode === 'Function' ? `Function(${JSON.stringify(body)})();` : `eval(${JSON.stringify(body)});`;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe('normal');
    expect((result.Value as { stringValue: () => string }).stringValue()).toBe('true');
  });
}

test('foreign conversion result failure uses its declaration Realm and restores caller', async () => {
  const { CreateDataPropertyOrThrow, Value, X } = await import('#self');
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const foreign = new ManagedRealm();
  const source = EnsureCompletion(foreign.evaluateScriptSkipDebugger('class S{operator uint8(){const x:any=257;return x;}}new S();'));
  expect(source.Type).toBe('normal');
  const local = new ManagedRealm();
  X(CreateDataPropertyOrThrow(local.GlobalObject, Value('source'), source.Value as import('#self').Value));
  const failure = EnsureCompletion(local.evaluateScriptSkipDebugger('const raw:any=source;const n:uint8=raw;'));
  expect(failure.Type).toBe('throw');
  expect(nativeErrorClass(failure.Value, foreign)).toBe('RangeError');
  expect(nativeErrorClass(failure.Value, local)).toBeUndefined();
  const next = EnsureCompletion(local.evaluateScriptSkipDebugger('String([] instanceof Array);'));
  expect(next.Type).toBe('normal');
  expect((next.Value as { stringValue: () => string }).stringValue()).toBe('true');
});

test('feature-disabled ordinary returns remain unchanged', () => {
  const agent = new Agent();
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('function f(){return 257;}String(f());'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue: () => string }).stringValue()).toBe('257');
});
