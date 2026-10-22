import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-partial-classes and #sec-interfaces-semantics: a source summary is not
// registration, and an open implements target is still a checking obligation.
const corpus = JSON.parse(readFileSync(new URL('../conformance/local-partial-admission.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed application does not publish later partials or contaminate another module', async () => {
  const results = await observeModuleSequence({
    bad: 'import {E,Has} from "dep";const e:Has=new E.<Has>();partial class E{get():string{return "bad";}}',
    dep: 'export interface Has{get():string;}export class E<T:type> implements T{}',
    good: 'interface Has{get():string;}class E<T:type> implements T{}partial class E{get():string{return "ok";}}const e:Has=new E.<Has>();if(e.get()!=="ok")throw new Error("context");',
  }, ['bad', 'bad', 'good', 'good']);
  for (const result of results.slice(0, 2)) {
    expect(result).toMatchObject({ status: 'rejected', errorClass: 'TypeError' });
    expect(result.diagnostic).toBeUndefined();
  }
  expect(results[0].bodyEntries).toEqual(['dep', 'bad']);
  expect(results[1].bodyEntries).toEqual([]);
  expect(results[1].loaded).toEqual([]);
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
