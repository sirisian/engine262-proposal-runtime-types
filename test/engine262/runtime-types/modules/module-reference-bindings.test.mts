import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-reference-bindings: module imports preserve the same read-through,
// effects and liveness rules as initialized ordinary lexical ref bindings.
const corpus = JSON.parse(readFileSync(new URL('../conformance/module-reference-bindings.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed module stays failed while a new borrow can repair later reads', async () => {
  const results = await observeModuleSequence({
    dep: 'const a:[].<uint8>=[1];export let ref r=a[0];globalThis.effects=0;export function relocate(){globalThis.effects++;a.reserve(64);}export function repair(){ref r=a[0];}',
    bad: 'import {r,relocate} from "dep";relocate();const value:any=r;',
    good: 'import {r,repair} from "dep";repair();if(r!==1||globalThis.effects!==1)throw new Error("repair");',
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
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});

test('ordinary module reads retain their behaviour with the extension disabled', async () => {
  const result = await observeModuleGraph({
    main: 'import {x,set} from "dep";const snapshot=x;set(2);if(snapshot!==1||x!==2)throw new Error("ordinary");',
    dep: 'export let x=1;export function set(v){x=v;}',
  }, 'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.errorClass).toBeUndefined();
  expect(result.diagnostic).toBeUndefined();
});
