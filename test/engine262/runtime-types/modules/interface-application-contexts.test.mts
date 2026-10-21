import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';
import { nativeErrorClass } from '../error-observer.mts';

// #sec-generic-constraint-contexts: written arguments retain their source;
// interface defaults and constraints retain the actual declaration binding.
const corpus = JSON.parse(readFileSync(new URL('../conformance/interface-application-contexts.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});

for (const depth of [8, 32]) {
  test(`an interface default observes depth ${depth} and restores the enclosing context`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm({ typeEvaluationBudget: { depth } } as never);
    const failed = EnsureCompletion(realm.evaluateScriptSkipDebugger('interface I<T:type=I.<>>{value:T;}const H:any=I;H.<>;'));
    expect(failed.Type).toBe('throw');
    expect(nativeErrorClass(failed.Value, realm)).toBe('TypeError');
    expect(TypeDiagnosticOf(failed.Value)).toBeUndefined();
    const next = EnsureCompletion(realm.evaluateScriptSkipDebugger('interface Good<T:type=string>{value:T;}String(Good.<> === Good.<string>);'));
    expect(next.Type).toBe('normal');
    expect((next.Value as { stringValue(): string }).stringValue()).toBe('true');
  });
}
