import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-partial-classes: a producer's partial contracts follow its declaration,
// even without imports. Only completed module checks publish contributions.
const corpus = JSON.parse(readFileSync(new URL('../conformance/imported-partial-contracts.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});

const sources = {
  base: 'export interface I<T:type>{get():T;}export const n:uint8=1;',
  bad: 'import {I,n} from "base";partial interface I<const T:type>{extra:string;}const wrong:string=n;',
  good: 'import {I} from "base";class Good implements I.<number>{get():number{return 1;}}',
  extension: 'import {I} from "base";partial interface I<string>{extra:string;}',
  retained: 'import {I} from "base";class Bad implements I.<string>{get():string{return "x";}}',
};

test('a failed import-aware check publishes no partial contract into a later graph', async () => {
  const [bad, good] = await observeModuleSequence(sources, ['bad', 'good']);
  expect(bad).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
  expect(good).toMatchObject({ status: 'fulfilled', bodyEntries: ['base', 'good'] });
  expect(good.diagnostic).toBeUndefined();
});

test("a failed publisher preserves a different module's completed contribution", async () => {
  const [extension, bad, retained, good] = await observeModuleSequence(sources, ['extension', 'bad', 'retained', 'good']);
  expect(extension).toMatchObject({ status: 'fulfilled', bodyEntries: ['base', 'extension'] });
  expect(bad).toMatchObject({ status: 'rejected', bodyEntries: [], diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
  expect(retained).toMatchObject({ status: 'rejected', bodyEntries: [], diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
  expect(retained.diagnostic?.arguments.join(' ')).toContain('extra');
  expect(good).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(good.diagnostic).toBeUndefined();
});
