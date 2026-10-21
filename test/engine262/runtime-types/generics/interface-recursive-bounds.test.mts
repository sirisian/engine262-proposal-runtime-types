import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';
import { nativeErrorClass } from '../error-observer.mts';

// #sec-computed-constraints: recursive description does not discharge admission.
const corpus = JSON.parse(readFileSync(new URL('../conformance/interface-recursive-bounds.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};
test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});

const divergent = [
  ['growing arguments', 'interface I<T:type extends I.<[T]>>{get():T;}const H:any=I;H.<string>;'],
  ['computed alias cycle', 'function recur(t:type):type{return I.<t>;}type Bound<T:type>=recur(T);interface I<T:type extends Bound.<T>>{value:T;}const H:any=I;H.<string>;'],
];
for (const [name, source] of divergent) for (const depth of [8, 32]) {
  test(`${name} observes depth ${depth} and restores the enclosing state`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm({ typeEvaluationBudget: { depth } } as never);
    const failed = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(failed.Type).toBe('throw');
    expect(nativeErrorClass(failed.Value, realm)).toBe('TypeError');
    expect((failed.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString).toContain('budget');
    expect(TypeDiagnosticOf(failed.Value)).toBeUndefined();
    const next = EnsureCompletion(realm.evaluateScriptSkipDebugger('interface Good<T:type extends Good.<T>>{get():T;}class D implements Good.<D>{get():D{return this;}}String(Good.<D>===Good.<D>);'));
    expect(next.Type).toBe('normal');
    expect((next.Value as { stringValue(): string }).stringValue()).toBe('true');
  });
}
