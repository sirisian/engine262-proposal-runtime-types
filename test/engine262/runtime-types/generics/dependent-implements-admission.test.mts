import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';

// #sec-interfaces-semantics: discharge dependent declaration obligations from
// actual member evidence before publishing a completed class application.
const corpus = JSON.parse(readFileSync(new URL('../conformance/dependent-implements-admission.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});

test('failed member admission restores contexts before another graph', async () => {
  const { observeModuleSequence } = await import('../module-observer.mts');
  const [bad, good, repeated] = await observeModuleSequence({
    bad: 'interface I{get():string;}class E<T:type> implements T{}const F:any=E;F.<I>;',
    main: 'interface I{get():string;}class E<T:type> implements T{get():string{return "ok";}}const F:any=E;const C=F.<I>;if(new C().get()!=="ok"||C!==F.<I>)throw new Error("context");',
  }, ['bad', 'main', 'main']);
  expect(bad).toMatchObject({ status: 'rejected', bodyEntries: ['bad'], errorClass: 'TypeError' });
  expect(bad.diagnostic).toBeUndefined();
  expect(good).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(repeated).toMatchObject({ status: 'fulfilled', loaded: [], bodyEntries: [] });
  for (const result of [good, repeated]) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
