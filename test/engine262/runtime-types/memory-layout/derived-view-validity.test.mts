import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-derived-view-validity: derivation preserves allocation history, not ancestor bounds.
const corpus = JSON.parse(readFileSync(new URL('../conformance/derived-view-validity.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('fresh source views work after relocation without reevaluating failed modules', async () => {
  const results = await observeModuleSequence({
    dep: 'class P{x:uint8;}export const a=new SoA.<P>(1);export const v=a.fields.x.subarray(0,1);globalThis.effects=0;',
    bad: 'import {a,v} from "dep";globalThis.effects++;a.reserve(64);const value:any=v[0];',
    good: 'import {a,v} from "dep";const fresh=a.fields.x.subarray(0,1);fresh[0]=3;let stale=false;try{const value:any=v[0];}catch(e){stale=e instanceof TypeError;}if(Number(a[0].x)!==3||globalThis.effects!==1||!stale)throw new Error("recovery");',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'TypeError' });
    expect(results[index].diagnostic).toBeUndefined();
  }
  expect(results[0].bodyEntries).toEqual(['dep', 'bad']);
  for (const index of [1, 3, 4]) {
    expect(results[index].loaded).toEqual([]);
    expect(results[index].bodyEntries).toEqual([]);
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
