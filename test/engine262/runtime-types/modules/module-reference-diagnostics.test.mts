import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-narrowing-flow and #sec-narrowfrom: a reference is not a snapshot,
// while a stable referent fact can still make a deciding test impossible.
// The audit's known stale-fact counterexamples are not conformance outcomes.
const corpus = JSON.parse(readFileSync(new URL('../conformance/module-reference-diagnostics.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('an impossible nominal guard does not prevent an independent value query', async () => {
  const results = await observeModuleSequence({
    bad: 'class E{}function first():ref E{let x:E=new E();return ref x;}let ref r=first();const y:E=r;if(!(y instanceof E))throw new Error("nominal");',
    good: 'class E{}function first():ref E{let x:E=new E();return ref x;}let ref r=first();const y:E=r;const answer=y instanceof E;if(JSON.stringify([answer])!=="[true]")throw new Error("query");',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_IMPOSSIBLE_TEST', phase: 'static' } });
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [], loaded: [] });
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});

test('a stable undefined guard does not contaminate later reference reads', async () => {
  const results = await observeModuleSequence({
    bad: 'let x;let ref r=x;if(r!==undefined||typeof r!=="undefined")throw new Error("undefined");',
    good: 'let n=0;const o={get x(){return n++===0?undefined:"s";}};let ref r=o.x;const answer=r!==undefined||typeof r!=="string";if(JSON.stringify([answer,n])!=="[false,2]")throw new Error("reads");',
  }, ['bad', 'good', 'bad', 'good']);
  for (const index of [0, 2]) {
    expect(results[index]).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_IMPOSSIBLE_TEST', phase: 'static' } });
  }
  expect(results[1]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [], loaded: [] });
  for (const index of [1, 3]) {
    expect(results[index].errorClass).toBeUndefined();
    expect(results[index].diagnostic).toBeUndefined();
  }
});
