import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph, observeModuleSequence } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/rest-construction-contexts.json', import.meta.url), 'utf8')) as {
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

for (const form of ['function', 'arrow', 'method']) {
  for (const order of [0, 1]) {
    test(`rest failure leaves later graphs independent (${form}, ${order})`, async () => {
      const source = (name: string) => corpus.cases.find((entry) => entry.name === name)!.modules.main;
      const results = await observeModuleSequence({ bad: source('unhandled-rest-failure'),
        good: source(`${form}-${order}-array`), later: source(`${form}-${order}-named-rest`) },
      ['bad', 'good', 'later', 'bad']);
      for (const index of [0, 3]) {
        expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'TypeError' });
        expect(results[index].bodyEntries).toEqual(index === 0 ? ['bad'] : []);
        expect(results[index].diagnostic).toBeUndefined();
      }
      for (const [index, name] of [[1, 'good'], [2, 'later']] as const) {
        expect(results[index]).toMatchObject({ status: 'fulfilled', bodyEntries: [name] });
        expect(results[index].errorClass).toBeUndefined();
        expect(results[index].diagnostic).toBeUndefined();
      }
    });
  }
}

for (const surface of ['eval', 'Function']) {
  test(`rest contexts through ${surface}`, () => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const source = corpus.cases.find((entry) => entry.name === 'method-0-tuple-suffix')!.modules.main;
    const quoted = JSON.stringify(source);
    const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(surface === 'eval' ? `eval(${quoted});` : `new Function(${quoted})();`));
    expect(completion.Type).toBe('normal');
  });
}

test('feature-off rest collection preserves source order and values', async () => {
  const result = await observeModuleGraph({ main: `
    let trace = '';
    function mark(value) { trace += value; return value; }
    function run(first, ...rest) {
      if (first !== 'a' || rest.length !== 2 || rest[0] !== 'b' || rest[1] !== 'c' || trace !== 'abc') throw new Error('rest order');
    }
    run(mark('a'), mark('b'), mark('c'));
  ` }, 'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.errorClass).toBeUndefined();
  expect(result.diagnostic).toBeUndefined();
});
