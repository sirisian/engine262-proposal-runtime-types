import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-narrowing-flow: instance initializers are deferred callable bodies.
// Their effects occur at construction; checked-code ownership is independent.
const corpus = JSON.parse(readFileSync(new URL('../conformance/construction-flow.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed field check does not publish facts into another class check', async () => {
  const results = await observeModuleSequence({
    bad: 'let n=0;class E{text:string=(n++,42);}const e=new E();',
    good: 'let n=0;class E{text:string=(n++,"ok");}if(n!==0)throw new Error("before");const e=new E();if(n!==1)throw new Error("after");const q:string=e.text;',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [], loaded: [] });
});

test('a throwing initializer retains prior runtime effects and does not rerun a failed module', async () => {
  const results = await observeModuleSequence({
    dep: 'export let n=0;function fail(){throw new Error("field");}export class E{text:string=(n++,fail());}',
    bad: 'import {E} from "dep";const e=new E();',
    good: 'import {n} from "dep";if(JSON.stringify([n])!=="[1]")throw new Error("effects");',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'Error' });
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
