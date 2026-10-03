import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/exported-declaration-outcomes.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

for (const { name, modules, expected } of corpus.cases) {
  test(name, async () => {
    const observation = await observeModuleGraph(modules);
    expect(observation).toMatchObject(expected);
    if (!expected.diagnostic) expect(observation.diagnostic).toBeUndefined();
    if (expected.status === 'fulfilled') expect(observation.errorClass).toBeUndefined();
  });
}
