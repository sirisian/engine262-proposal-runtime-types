import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-exported-constructor-aliases: publication keeps the producer's origin proof.
const corpus = JSON.parse(readFileSync(new URL('../conformance/exported-constructor-aliases.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('failed alias consumers leave the producer unevaluated and a compatible consumer usable', async () => {
  const results = await observeModuleSequence({
    dep: 'globalThis.effects=(globalThis.effects||0)+1;class E{text:string="ok";get(){return this.text;}}export const Alias=E;export default E;',
    bad: 'import {Alias} from "dep";const result:boolean=new Alias().get();',
    good: 'import * as ns from "dep";const result:string=new ns.default().get();if(result!=="ok"||globalThis.effects!==1)throw new Error("effects");',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_ASSIGNABILITY' }, bodyEntries: [] });
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});

test('a failed alias producer does not poison another producer in the same realm', async () => {
  const results = await observeModuleSequence({
    badDep: 'class E{text:string="bad";}export const Alias=E;const invalid:boolean="bad";',
    bad: 'import {Alias} from "badDep";new Alias();',
    goodDep: 'class E{text:string="ok";}export const Alias=E;',
    good: 'import {Alias} from "goodDep";const result:string=new Alias().text;if(result!=="ok")throw new Error("identity");',
  }, ['bad', 'bad', 'good', 'good']);
  for (const result of results.slice(0, 2)) {
    expect(result).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_ASSIGNABILITY' }, bodyEntries: [] });
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['goodDep', 'good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
