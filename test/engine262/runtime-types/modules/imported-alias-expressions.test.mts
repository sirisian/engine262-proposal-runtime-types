import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-type-arguments-and-placement-new-in-expression-position: imports keep
// the alias's declaration contract independently of its transparent expansion.
const corpus = JSON.parse(readFileSync(new URL('../conformance/imported-alias-expressions.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('failed imported alias admission preserves dependency effects and later successful applications', async () => {
  const results = await observeModuleSequence({
    bad: 'import {I} from "dep";globalThis.aliasConsumerEntered=true;I.<uint8>;',
    dep: 'globalThis.aliasProducerCount=(globalThis.aliasProducerCount||0)+1;function bound():type{return string;}export type I<T:type extends bound()> = T;',
    good: 'import {I} from "dep";if(globalThis.aliasConsumerEntered!==undefined||globalThis.aliasProducerCount!==1)throw new Error("effects");if(I.<...[string]>!==string||I.<string>!==string)throw new Error("identity");',
  }, ['bad', 'bad', 'good', 'good']);
  expect(results[0]).toMatchObject({ status: 'rejected', bodyEntries: ['dep'], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'pre-evaluation' } });
  expect(results[1]).toMatchObject({ status: 'rejected', loaded: [], bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'pre-evaluation' } });
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
