import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-typed-classes: foreign instance, constructor and static descriptions
// retain their producer's dependencies; inferred admission retains its context.
const corpus = JSON.parse(readFileSync(new URL('../conformance/foreign-class-context.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});

test('consumer failures and shadows leave the producer available to later consumers', async () => {
  const [first, bad, second, repeated] = await observeModuleSequence({
    first: 'import {E} from "dep";const e=new E("ok");',
    bad: 'import {E} from "dep";new E(true);',
    second: 'import {E} from "dep";interface Has<T:type>{wrong():boolean;}const e=new E("ok");',
    dep: 'import {Has} from "provider";export class E implements Has.<E>{constructor(x:string){}get():E{return this;}}',
    provider: 'export interface Has<T:type>{get():T;}',
  }, ['first', 'bad', 'second', 'first']);
  expect(first).toMatchObject({ status: 'fulfilled', bodyEntries: ['provider', 'dep', 'first'] });
  expect(bad).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
  expect(second).toMatchObject({ status: 'fulfilled', bodyEntries: ['second'] });
  expect(repeated).toMatchObject({ status: 'fulfilled', loaded: [], bodyEntries: [] });
  for (const result of [first, second, repeated]) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
