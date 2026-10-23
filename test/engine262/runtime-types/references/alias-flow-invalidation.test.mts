import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-narrowing-flow: lexical reference origins accompany source-position
// value facts; writes and rebinding invalidate the affected dependencies.
const corpus = JSON.parse(readFileSync(new URL('../conformance/reference-alias-invalidation.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed reference store does not leak a location or value fact into another module', async () => {
  const results = await observeModuleSequence({
    bad: 'let x:number=1;let ref r=x;r="bad";',
    good: 'let x=1,y=2;let ref a=x;let ref r=a;if(r!==1)throw new Error("before");ref a=y;if(r!==2)throw new Error("after");y=3;if(r!==3)throw new Error("store");',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [], loaded: [] });
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});

test('an expired reference still fails and explicit later rebinding can establish a live location', async () => {
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
