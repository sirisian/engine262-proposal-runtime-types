import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph, observeModuleSequence } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/function-decorator-contexts.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; script: boolean; expected: {
    status: 'fulfilled' | 'rejected'; bodyEntries: string[]; errorClass?: string; diagnostic?: Record<string, unknown>;
  } }[];
};

for (const { name, modules, expected, script } of corpus.cases) {
  test(`Module: ${name}`, async () => {
    const result = await observeModuleGraph(modules);
    expect(result).toMatchObject(expected);
    if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
    if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
  });
  if (!script) continue;
  test(`Script: ${name}`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    let bodies = 0;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => { if (node.type === 'ScriptBody') bodies += 1; };
    try {
      const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(modules.main));
      const errorClass = completion.Type === 'throw' ? nativeErrorClass(completion.Value, realm) : undefined;
      const diagnostic = TypeDiagnosticOf(completion.Value);
      expect(completion.Type).toBe(expected.status === 'fulfilled' ? 'normal' : 'throw');
      expect(bodies).toBe(expected.bodyEntries.length);
      expect(errorClass).toBe(expected.errorClass);
      if (expected.diagnostic) expect(diagnostic).toMatchObject(expected.diagnostic);
      else expect(diagnostic).toBeUndefined();
      expect(agent.jobQueue?.length ?? 0).toBe(0);
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

test('failed decorator leaves later module graphs independent', async () => {
  const source = (name: string) => corpus.cases.find((entry) => entry.name === name)!.modules.main;
  const results = await observeModuleSequence({ bad: source('unhandled-decorator'),
    good: source('reflection-function'), later: source('captured-frame') },
  ['bad', 'good', 'later', 'bad']);
  for (const index of [0, 3]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'Error' });
    expect(results[index].bodyEntries).toEqual(index === 0 ? ['bad'] : []);
    expect(results[index].diagnostic).toBeUndefined();
  }
  for (const [index, name] of [[1, 'good'], [2, 'later']] as const) {
    expect(results[index]).toMatchObject({ status: 'fulfilled', bodyEntries: [name] });
    expect(results[index].errorClass).toBeUndefined();
    expect(results[index].diagnostic).toBeUndefined();
  }
});

for (const surface of ['eval', 'Function']) {
  test(`decorated adopted signature through ${surface}`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const source = corpus.cases.find((entry) => entry.name === 'reflection-function')!.modules.main;
    const quoted = JSON.stringify(source);
    const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(surface === 'eval' ? `eval(${quoted});` : `new Function(${quoted})();`));
    expect(completion.Type).toBe('normal');
  });
}

test('feature-off ordinary functions keep their behavior', async () => {
  const result = await observeModuleGraph({ main: 'const f = function(value) { return value; }; if (f(7) !== 7) throw new Error("call");' }, 'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.errorClass).toBeUndefined();
  expect(result.diagnostic).toBeUndefined();
});

test('feature-off rejects decorator syntax', async () => {
  const result = await observeModuleGraph({ main: 'function touch(c) {} const f = @touch function(value) { return value; };' }, 'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'SyntaxError' });
  expect(result.diagnostic).toBeUndefined();
});
