import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-type-arguments-and-placement-new-in-expression-position and
// #sec-generic-where: producer inputs and erased inner obligations survive imports.
const corpus = JSON.parse(readFileSync(new URL('../conformance/imported-alias-dependencies.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('inner predicate failure retains producer effects and does not poison later applications', async () => {
  const results = await observeModuleSequence({
    bad: 'import {I} from "dep";globalThis.consumerEntered=true;I.<0>;',
    dep: 'import {Inner} from "leaf";globalThis.outerCount=(globalThis.outerCount||0)+1;export type I<N:uint32> = Inner.<N>;',
    leaf: 'globalThis.innerCount=(globalThis.innerCount||0)+1;const minimum=1;function allowed(n:uint32):boolean{return n>=minimum;}export type Inner<N:uint32> = uint32 where allowed(N);',
    good: 'import {I} from "dep";const minimum=9;if(globalThis.consumerEntered!==undefined||globalThis.outerCount!==1||globalThis.innerCount!==1||minimum!==9)throw new Error("effects or environment");I.<1>;',
    otherBad: 'import {I} from "dep";globalThis.consumerEntered=true;I.<0>;',
  }, ['bad', 'bad', 'good', 'good', 'otherBad']);
  expect(results[0]).toMatchObject({ status: 'rejected', bodyEntries: ['leaf', 'dep'], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_WHERE_UNSATISFIED', phase: 'pre-evaluation' } });
  for (const result of [results[1], results[4]]) {
    expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_WHERE_UNSATISFIED', phase: 'pre-evaluation' } });
  }
  expect(results[1].loaded).toEqual([]);
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
