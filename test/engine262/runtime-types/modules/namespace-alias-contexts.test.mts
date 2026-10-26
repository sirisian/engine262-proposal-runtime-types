import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-contextual-typing: namespace qualification preserves the exported
// declaration's binders independently of equal public Type Objects.
const corpus = JSON.parse(readFileSync(new URL('../conformance/namespace-alias-contexts.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('failed namespace consumer does not replace another consumer\'s alias context', async () => {
  const source = (name: string) => corpus.cases.find((entry) => entry.name === name)!.modules;
  const results = await observeModuleSequence({ dep: source('direct-binding').dep,
    bad: source('wrong-body').main, good: source('direct-binding').main,
    later: source('reverse-and-warm').main }, ['bad', 'good', 'later', 'bad']);
  for (const index of [0, 3]) {
    expect(results[index]).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
      diagnostic: { code: 'RT_ASSIGNABILITY', phase: 'static' } });
  }
  for (const index of [1, 2]) {
    expect(results[index]).toMatchObject({ status: 'fulfilled', bodyEntries: index === 1 ? ['dep', 'good'] : ['later'] });
    expect(results[index].errorClass).toBeUndefined();
    expect(results[index].diagnostic).toBeUndefined();
  }
});

test('feature-off ordinary namespace reads preserve getter count and exception identity', async () => {
  const result = await observeModuleGraph({ dep: 'export const value=7;', main: `
    import * as ns from "dep";
    let reads=0; const sentinel={};
    const holder={get ok(){reads++;return ns;}, get bad(){reads++;throw sentinel;}};
    if(holder.ok.value!==7||reads!==1)throw new Error("read");
    let caught=false;
    try{holder.bad.value;}catch(error){if(error!==sentinel)throw error;caught=true;}
    if(!caught||reads!==2)throw new Error("exception");
  ` }, 'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.errorClass).toBeUndefined();
  expect(result.diagnostic).toBeUndefined();
});

test('feature-off rejects typed namespace annotations', async () => {
  const result = await observeModuleGraph(corpus.cases.find((entry) => entry.name === 'direct-binding')!.modules,
    'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'SyntaxError' });
  expect(result.diagnostic).toBeUndefined();
});
