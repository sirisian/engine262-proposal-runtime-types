import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';

// #sec-contextual-types: separately parsed annotations select the actual
// enclosing parameter binding, independently of a caller's generic arguments.
const corpus = JSON.parse(readFileSync(new URL('../conformance/eval-generic-parameters.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('ordinary eval keeps its lexical scope with runtime types disabled', async () => {
  const result = await observeModuleGraph({ main: `
    function outer(value) { return () => eval("value"); }
    const first = outer(7), second = outer("ok");
    function caller(value, read) { return read(); }
    if (caller(false, first) !== 7 || caller(0, second) !== "ok" || first() !== 7) throw new Error("scope");
  ` }, 'main', { runtimeTypes: false });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.errorClass).toBeUndefined();
  expect(result.diagnostic).toBeUndefined();
});
