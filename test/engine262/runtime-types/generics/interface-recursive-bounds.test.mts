import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';
import { observeScript } from '../harness.mts';
import { nativeErrorClass } from '../error-observer.mts';

// #sec-computed-constraints: recursive description does not discharge admission.
const corpus = JSON.parse(readFileSync(new URL('../conformance/interface-recursive-bounds.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};
test.each(corpus.cases)('Module: $name', async ({ modules, expected }) => {
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

// Script admission must reject closed annotations before any body effects too.
for (const { name, modules, expected } of corpus.cases) {
  if (Object.keys(modules).length !== 1) continue;
  test(`Script: ${name}`, () => {
    const result = observeScript(modules.main);
    expect(result.completion.Type).toBe(expected.status === 'fulfilled' ? 'normal' : 'throw');
    expect(result.bodyEntered).toBe(expected.bodyEntries!.length > 0);
    expect(result.errorClass).toBe(expected.errorClass);
    if (expected.diagnostic) expect(result.diagnostic).toMatchObject(expected.diagnostic);
    else expect(result.diagnostic).toBeUndefined();
  });
}

test('failed recursive class admission clears the unfinished specialization before retry', async () => {
  const results = await observeModuleSequence({
    dep: 'export interface I<T:type extends I.<T>>{get():T;}export class E<U:type> implements I.<E.<U>>{}',
    bad: 'import {E} from "dep";for(let i=0;i<2;i++){let caught=false;try{E.<uint8>;}catch(e){if(!(e instanceof TypeError))throw e;caught=true;}if(!caught)throw new Error("unfinished application escaped");}',
    good: 'import {E,I} from "dep";partial class E{get():E.<U>{return this;}}const e=new E.<uint8>();if(e.get()!==e||E.<uint8>!==E.<uint8>)throw new Error("retry");',
  }, ['bad', 'good']);
  expect(results[0]).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'bad'] });
  expect(results[1]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  for (const result of results) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
