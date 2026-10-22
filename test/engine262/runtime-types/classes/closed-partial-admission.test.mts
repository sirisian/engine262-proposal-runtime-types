import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-interfaces-semantics: fixed target checks and generic member completion
// have distinct boundaries; a lookup promise is not a declaration collision.
const corpus = JSON.parse(readFileSync(new URL('../conformance/closed-partial-admission.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed application can be retried after another module registers the partial', async () => {
  const results = await observeModuleSequence({
    dep: 'globalThis.effects=(globalThis.effects||0)+1;export interface Has{get():string;}export class E<T:type> implements Has{}',
    bad: 'import {E} from "dep";E.<uint8>;',
    good: 'import {E,Has} from "dep";partial class E{get():string{return "ok";}}const e:Has=new E.<uint8>();if(e.get()!=="ok"||globalThis.effects!==1||E.<uint8>!==E.<uint8>)throw new Error("retry");',
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
