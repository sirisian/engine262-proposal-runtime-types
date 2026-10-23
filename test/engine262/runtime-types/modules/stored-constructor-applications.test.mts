import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-stored-constructor-applications: use selected arguments in their producer context.
const corpus = JSON.parse(readFileSync(new URL('../conformance/stored-constructor-applications.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('failed selected consumers leave the producer unevaluated and its original selection reusable', async () => {
  const results = await observeModuleSequence({
    dep: 'globalThis.effects=(globalThis.effects||0)+1;class C<T:type>{value:T;constructor(x:T){this.value=x;}get(){return this.value;}}export const Selected=C.<string>;export default Selected;',
    bad: 'import {Selected} from "dep";const result:boolean=new Selected("ok").get();',
    good: 'import * as ns from "dep";const result:string=new ns.default("ok").get();if(result!=="ok"||globalThis.effects!==1)throw new Error("effects");',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_ASSIGNABILITY' }, bodyEntries: [] });
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});

test('a failed default publishes no selection and does not poison an independent producer', async () => {
  const results = await observeModuleSequence({
    badDep: 'function fail(t:type):type{throw new Error("default");}class C<T:type=fail(string)>{}export const Selected=C.<>;',
    bad: 'import {Selected} from "badDep";new Selected();',
    goodDep: 'class C<T:type=string>{value:T;constructor(x:T){this.value=x;}}export const Selected=C.<>;',
    good: 'import {Selected} from "goodDep";const result:string=new Selected("ok").value;if(result!=="ok")throw new Error("result");',
  }, ['bad', 'bad', 'good', 'good']);
  for (const result of results.slice(0, 2)) {
    expect(result).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_DEFAULT_EVALUATION', phase: 'pre-evaluation' }, bodyEntries: [] });
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['goodDep', 'good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
