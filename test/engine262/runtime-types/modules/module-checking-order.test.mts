import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';

interface Fixture {
  name: string;
  modules: Record<string, string>;
  expected: Partial<ModuleObservation>;
  runtimeTypes?: boolean;
}
const corpus = JSON.parse(readFileSync(new URL('../conformance/module-checking-outcomes.json', import.meta.url), 'utf8')) as { cases: Fixture[] };

test.each(corpus.cases)('$name', async ({ modules, expected, runtimeTypes }) => {
  const result = await observeModuleGraph(modules, 'main', { runtimeTypes });
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});

test('an unsettled module is a failed observation, not a rejected program', async () => {
  await expect(observeModuleGraph({ main: 'await new Promise(() => {});' }, 'main', { timeoutMs: 25 }))
    .rejects.toThrow('Module evaluation did not settle');
});

test('a missing fixture is a harness failure', async () => {
  await expect(observeModuleGraph({ main: 'import "missing";' })).rejects.toThrow('Missing module fixture: missing');
});
