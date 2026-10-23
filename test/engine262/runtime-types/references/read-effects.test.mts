import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-narrowing-flow: consume reference values at their source position;
// keep location formation and separately required receiving reads distinct.
const corpus = JSON.parse(readFileSync(new URL('../conformance/reference-read-effects.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed getter does not leak checking or flow state into another module', async () => {
  const results = await observeModuleSequence({
    bad: 'const o={get x(){throw new Error("getter");}};let ref r=o.x;const value=r;',
    good: 'let n=0;const o={get x(){n++;return n;}};let ref r=o.x;if(n!==0)throw new Error("before");const value=r;if(n!==1)throw new Error("after");',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'Error' });
    expect(results[index].diagnostic).toBeUndefined();
  }
  expect(results[0].bodyEntries).toEqual(['bad']);
  for (const index of [1, 3, 4]) expect(results[index].bodyEntries).toEqual([]);
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [], loaded: [] });
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});

test('read-effect analysis does not bypass expired-reference failure or later repair', async () => {
  const results = await observeModuleSequence({
    dep: 'const a:[].<uint8>=[1];export let ref r=a[0];export function invalidate(){a.reserve(64);}export function repair(){ref r=a[0];r=2;}',
    bad: 'import {r,invalidate} from "dep";invalidate();const value:any=r;',
    good: 'import {r,repair} from "dep";repair();if(JSON.stringify([r])!=="[2]")throw new Error("repair");',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'TypeError' });
    expect(results[index].diagnostic).toBeUndefined();
  }
  expect(results[0].bodyEntries).toEqual(['dep', 'bad']);
  for (const index of [1, 3, 4]) {
    expect(results[index].bodyEntries).toEqual([]);
    expect(results[index].loaded).toEqual([]);
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
});
