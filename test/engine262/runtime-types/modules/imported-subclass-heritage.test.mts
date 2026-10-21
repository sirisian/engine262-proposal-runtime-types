import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-typed-classes: an imported base retains its producer-owned origin and
// inherited contracts; import immutability does not prove producer stability.
const corpus = JSON.parse(readFileSync(new URL('../conformance/imported-subclass-heritage.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});


test('a failed importing graph does not contaminate another graph in the same realm', async () => {
  const modules = {
    dep: 'export interface Has<T:type>{get():T;}export class E implements Has.<E>{get():E{return this;}}',
    bad: 'import {Has,E} from "dep";class D extends E{}const x:Has.<D>=new D();',
    good: 'import {Has,E} from "dep";class D extends E{}const x:Has.<E>=new D();',
  };
  const [bad, good] = await observeModuleSequence(modules, ['bad', 'good']);
  expect(bad).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
  expect(good).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'good'] });
  expect(good.errorClass).toBeUndefined();
  expect(good.diagnostic).toBeUndefined();
});

test('successive importers reuse the evaluated producer without rerunning it', async () => {
  const modules = {
    dep: 'export let count=0;export interface Has<T:type>{get():T;}export class E implements Has.<E>{constructor(){count+=1;}get():E{return this;}}',
    first: 'import {Has,E,count} from "dep";class D extends E{}const x:Has.<E>=new D();if(count!==1)throw new Error("first");',
    second: 'import {Has,E,count} from "dep";class D extends E{}const x:Has.<E>=new D();if(count!==2)throw new Error("second");',
  };
  const [first, second] = await observeModuleSequence(modules, ['first', 'second']);
  expect(first).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'first'] });
  expect(second).toMatchObject({ status: 'fulfilled', bodyEntries: ['second'] });
  for (const result of [first, second]) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
