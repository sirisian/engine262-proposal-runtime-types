import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, type JSStringValue } from '#self';

// #sec-contextual-types: a selected builder result retains its declaration
// context without attaching provenance to an interned Type Object or copy.
const corpus = JSON.parse(readFileSync(new URL('../conformance/computed-result-contexts.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('ordinary reflective calls preserve values and abrupt completions with runtime types disabled', async () => {
  const result = await observeModuleGraph({ main: `
    const receiver = {};
    const value = {};
    function target(argument) { if (this !== receiver) throw new Error("receiver"); return argument; }
    const results = [target.call(receiver, value), target.apply(receiver, [value]),
      Reflect.apply(target, receiver, [value]), target.bind(receiver)(value)];
    if (results.some(result => result !== value)) throw new Error("identity");
    let copy;
    const holder = {};
    if ((copy = value) !== value || copy !== value || (holder.value = value) !== value) throw new Error("store");
    if (({} = value) !== value) throw new Error("destructure");
    copy = false;
    if ((copy ||= value) !== value || (copy &&= value) !== value || (copy ??= {}) !== value) throw new Error("logical");
    function factory() { return value; }
    if (new factory() !== value || Reflect.construct(factory, []) !== value || new (factory.bind(null))() !== value) throw new Error("construct");
    const failure = {};
    function fail() { throw failure; }
    let caught = 0;
    for (const invoke of [() => fail.call(receiver), () => fail.apply(receiver, []),
      () => Reflect.apply(fail, receiver, []), () => fail.bind(receiver)()]) {
      try { invoke(); } catch (error) { if (error !== failure) throw error; caught++; }
    }
    if (caught !== 4) throw new Error("completion");
  ` }, 'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.errorClass).toBeUndefined();
  expect(result.diagnostic).toBeUndefined();
});

test('an overridden return cannot publish its context into a later successful consumer', async () => {
  const results = await observeModuleSequence({
    dep: 'export function choose(fail:boolean):type{type A=<U:type>(x:U)=>U;type B=<V:type>(x:V)=>V;try{return fail?A:B;}finally{if(fail)throw new Error("failed return");}}',
    bad: 'import {choose} from "dep";type G=choose(true);',
    good: 'import {choose} from "dep";type G=choose(false);const g:G=function(x:V):V{return x;};if(g.<number>(7)!==7)throw new Error("value");',
  }, ['bad', 'good', 'bad']);
  for (const index of [0, 2]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
      bodyEntries: index === 0 ? ['dep'] : [], diagnostic: { code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' } });
  }
  expect(results[1]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[1].diagnostic).toBeUndefined();
  expect(results[1].errorClass).toBeUndefined();
});

test('budget exhaustion discards intermediate result context and permits independent recovery', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ typeEvaluationBudget: { steps: 1000 } } as never);
  let bodies = 0;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodies += 1;
  };
  try {
    const failed = EnsureCompletion(realm.evaluateScriptSkipDebugger('function fail():type{type R=<U:type>(x:U)=>U;function inner():type{return R;}inner();while(true){}return R;}type Bad=fail();'));
    expect(failed.Type).toBe('throw');
    expect(TypeDiagnosticOf(failed.Value)).toMatchObject({ code: 'RT_TYPE_EVALUATION_LIMIT', phase: 'pre-evaluation' });
    expect(bodies).toBe(0);
    const good = EnsureCompletion(realm.evaluateScriptSkipDebugger('function build():type{type R=<V:type>(x:V)=>V;return R;}type Good=build();const g:Good=function(x:V):V{return x;};g.<number>(7);"ok";'));
    expect(good.Type).toBe('normal');
    expect((good.Value as JSStringValue).stringValue()).toBe('ok');
    expect(bodies).toBe(1);
  } finally {
    delete agent.hostDefinedOptions.onNodeEvaluation;
  }
});
