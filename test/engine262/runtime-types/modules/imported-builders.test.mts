import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/imported-builder-outcomes.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const observation = await observeModuleGraph(modules);
  expect(observation).toMatchObject(expected);
  if (expected.status === 'fulfilled') {
    expect(observation.errorClass).toBeUndefined();
    expect(observation.diagnostic).toBeUndefined();
  }
});
