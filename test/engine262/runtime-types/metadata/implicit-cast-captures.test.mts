import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';

// #sec-primitive-operator-blocks: the selected cast owns its capture arguments.
const corpus = JSON.parse(readFileSync(new URL('../conformance/implicit-cast-captures.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});
