import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';

// #sec-higher-kinded-parameters: a constructor argument is not an empty application.
const corpus = JSON.parse(readFileSync(new URL('../conformance/interface-higher-kinded-arguments.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};
test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});
