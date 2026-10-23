import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-imported-method-returns: participation and producer identity survive import spelling.
const corpus = JSON.parse(readFileSync(new URL('../conformance/imported-method-returns.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('namespace checking fails before effects and leaves a compatible graph usable', async () => {
  const results = await observeModuleSequence({
    dep: 'globalThis.effects=(globalThis.effects||0)+1;export class E{get(value:string){return value;}}',
    bad: 'import * as ns from "dep";const result:boolean=new ns.E().get("ok");',
    good: 'import * as ns from "dep";const result:string=new ns.E().get("ok");if(result!=="ok"||globalThis.effects!==1)throw new Error("effects");',
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
