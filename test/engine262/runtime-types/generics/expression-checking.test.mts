import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-type-arguments-and-placement-new-in-expression-position: the application
// demands admission even when its result is unused. Computations keep their
// own boundary; a known declaration never initializes an unavailable input.
const corpus = JSON.parse(readFileSync(new URL('../conformance/generic-expression-checking.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed application does not poison later declarations or repeat successful bodies', async () => {
  const results = await observeModuleSequence({
    bad: 'function fail():type{throw new Error("default");}interface I<T:type=fail()>{}I.<>;',
    good: 'interface I<T:type extends string>{}const A=I.<string>;if(A!==I.<string>)throw new Error("identity");',
  }, ['bad', 'good', 'good']);
  expect(results[0]).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_DEFAULT_EVALUATION', phase: 'pre-evaluation' } });
  expect(results[1]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(1)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
