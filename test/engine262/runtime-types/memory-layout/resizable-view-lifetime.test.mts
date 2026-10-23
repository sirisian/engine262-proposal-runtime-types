import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-buffer-view-lifetime: byte-address recovery is distinct from owned-element identity.
const corpus = JSON.parse(readFileSync(new URL('../conformance/resizable-view-lifetime.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('regrowth repairs the byte view but does not reevaluate a failed module', async () => {
  const results = await observeModuleSequence({
    dep: 'class P{x:uint8;}export const b=new ArrayBuffer(8,{maxByteLength:32});const a=Span.<P>(b,0,8);export const holder={v:a[0]};globalThis.effects=0;',
    bad: 'import {b,holder} from "dep";globalThis.effects++;b.resize(4);const copy=holder.v;',
    good: 'import {b,holder} from "dep";b.resize(8);holder.v.x=3;if(Number(new Uint8Array(b)[0])!==3||globalThis.effects!==1)throw new Error("recovery");',
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
