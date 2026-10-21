import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-module-type-checking-order: an imported structural summary does not
// initialize its binding or defer a required read behind a local class input.
const corpus = JSON.parse(readFileSync(new URL('../conformance/cyclic-interface-availability.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});

test('a rejected cycle preserves prior effects and does not contaminate a later graph', async () => {
  const modules = {
    main: 'import "seed";import {E} from "dep";export interface Has<T:type>{get():T;}',
    seed: 'globalThis.cyclicInterfaceCount=(globalThis.cyclicInterfaceCount||0)+1;',
    dep: 'import {Has} from "main";globalThis.candidateEntered=true;export class E implements Has.<E>{get():E{return this;}}',
    good: 'import "seed";import {Has} from "provider";if(globalThis.cyclicInterfaceCount!==1||globalThis.candidateEntered!==undefined)throw new Error("effects");class E implements Has.<E>{get():E{return this;}}',
    provider: 'export interface Has<T:type>{get():T;}',
  };
  const [first, repeated, good] = await observeModuleSequence(modules, ['main', 'main', 'good']);
  expect(first).toMatchObject({ status: 'rejected', bodyEntries: ['seed'], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' } });
  expect(repeated).toMatchObject({ status: 'rejected', loaded: [], bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' } });
  expect(good).toMatchObject({ status: 'fulfilled', bodyEntries: ['provider', 'good'] });
  expect(good.errorClass).toBeUndefined();
  expect(good.diagnostic).toBeUndefined();
});

test('an available cyclic producer is evaluated only once across importers', async () => {
  const modules = {
    main: 'import {E} from "dep";import {Has} from "provider";export const marker=1;const x=new E();',
    dep: 'import {Has} from "provider";export class E implements Has.<E>{get():E{return this;}}',
    provider: 'import {marker} from "main";globalThis.interfaceProducerCount=(globalThis.interfaceProducerCount||0)+1;export interface Has<T:type>{get():T;}',
    second: 'import {E} from "dep";import {Has} from "provider";const x:Has.<E>=new E();if(globalThis.interfaceProducerCount!==1)throw new Error("repeated");',
  };
  const [first, second] = await observeModuleSequence(modules, ['main', 'second']);
  expect(first).toMatchObject({ status: 'fulfilled', bodyEntries: ['provider', 'dep', 'main'] });
  expect(second).toMatchObject({ status: 'fulfilled', bodyEntries: ['second'] });
  for (const result of [first, second]) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
