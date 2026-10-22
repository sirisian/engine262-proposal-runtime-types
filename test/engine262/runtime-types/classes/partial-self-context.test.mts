import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-partial-classes: self denotes the receiving application, including in
// retained closures, and is independent of a member's own generic binders.
const corpus = JSON.parse(readFileSync(new URL('../conformance/partial-self-context.json', import.meta.url), 'utf8')) as {
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
    dep: 'globalThis.effects=(globalThis.effects||0)+1;export interface Has<T:type>{get():T;}export class E<T:type> implements Has.<E>{}',
    bad: 'import {E} from "dep";E.<uint8>;',
    good: 'import {E,Has} from "dep";partial class E{get():E{return this;}}const e=new E.<uint8>();if(e.get()!==e||globalThis.effects!==1||E.<uint8>!==E.<uint8>)throw new Error("retry");',
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
