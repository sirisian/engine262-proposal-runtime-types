import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// The same constructor/protocol evidence gates narrowing and impossible tests.
// Fixtures retain normal hook/conversion effects and pin body-entry/phase order.
const corpus = JSON.parse(readFileSync(new URL('../conformance/nominal-instanceof-origins.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
  sequences: { name: string; modules: Record<string, string>; entries: string[]; expected: Partial<ModuleObservation>[] }[];
};
function assertObservation(result: ModuleObservation, expected: Partial<ModuleObservation>) {
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
}
for (const item of corpus.cases) {
  test(item.name, async () => {
    assertObservation(await observeModuleGraph(item.modules), item.expected);
  });
}
for (const item of corpus.sequences) {
  test(item.name, async () => {
    const results = await observeModuleSequence(item.modules, item.entries);
    expect(results).toHaveLength(item.expected.length);
    results.forEach((result, index) => assertObservation(result, item.expected[index]));
  });
}
