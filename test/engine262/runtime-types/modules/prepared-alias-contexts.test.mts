import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-contextual-typing: preparation and a fresh eval parse retain the selected
// binding's signature context, independently of public Type Object identity.
const corpus = JSON.parse(readFileSync(new URL('../conformance/prepared-alias-contexts.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed eval does not publish context into another consumer or producer', async () => {
  const source = (name: string) => corpus.cases.find((entry) => entry.name === name)!.modules;
  const results = await observeModuleSequence({
    dep: source('eval-named-binding').dep,
    bad: source('eval-named-wrong-body').main,
    good: source('eval-named-binding').main,
    other: 'export type G=<Other:type>(x:Other)=>Other;',
    later: 'import {G} from "other";eval(' + JSON.stringify('const f:G=function(x:Other):Other{return x;};if(f.<number>(9)!==9)throw new Error("value");') + ');',
  }, ['bad', 'good', 'later', 'bad']);
  for (const index of [0, 3]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
      bodyEntries: index === 0 ? ['dep', 'bad'] : [], diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
  }
  for (const index of [1, 2]) {
    expect(results[index]).toMatchObject({ status: 'fulfilled', bodyEntries: index === 1 ? ['good'] : ['other', 'later'] });
    expect(results[index].diagnostic).toBeUndefined();
    expect(results[index].errorClass).toBeUndefined();
  }
});

test('feature-off eval keeps ordinary lexical namespace reads', async () => {
  const result = await observeModuleGraph({ dep: 'export const value=7;',
    main: 'import * as ns from "dep";if(eval("ns.value")!==7)throw new Error("value");' }, 'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.errorClass).toBeUndefined();
  expect(result.diagnostic).toBeUndefined();
});

test('feature-off eval rejects typed syntax when the nested source is parsed', async () => {
  const result = await observeModuleGraph({ main: 'eval("const value:number=7;");' }, 'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'SyntaxError' });
  expect(result.diagnostic).toBeUndefined();
});
