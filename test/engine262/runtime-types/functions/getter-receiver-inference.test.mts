import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-getter-contribution-receivers: property reads retain declaration-owned dependencies.
const corpus = JSON.parse(readFileSync(new URL('../conformance/getter-receiver-inference.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed getter consumer neither evaluates the producer nor poisons later compatible consumers', async () => {
  const results = await observeModuleSequence({
    dep: 'export class E{text:string="ok";get value(){return this.text;}}',
    bad: 'import {E} from "dep";const q:boolean=new E().value;',
    good: 'import * as ns from "dep";const q:string=new ns.E().value;',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' }, bodyEntries: [] });
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});

test('a failed accessor-pair declaration does not retain an unrelated receiver or publication', async () => {
  const results = await observeModuleSequence({
    bad: 'class E{static text:string="ok";static get value(){return this.#value;}static get #value(){return this.text;}static set #value(x:boolean){}}',
    good: 'class E{static text:boolean=true;static get value(){return this.#value;}static get #value(){return this.text;}static set #value(x:boolean){}}const q:boolean=E.value;',
  }, ['bad', 'bad', 'good', 'good']);
  for (const result of results.slice(0, 2)) {
    expect(result).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' }, bodyEntries: [] });
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
