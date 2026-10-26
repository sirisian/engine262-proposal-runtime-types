import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';
import { observeScript } from '../harness.mts';

// #sec-interfaces-semantics: a self candidate belongs to the actual class
// formation, including a non-generic class and separate lexical activations.
const corpus = JSON.parse(readFileSync(new URL('../conformance/interface-self-contexts.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

for (const { name, modules, expected } of corpus.cases) {
  test(`Module: ${name}`, async () => {
    const result = await observeModuleGraph(modules);
    expect(result).toMatchObject(expected);
    if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
    if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
  });
  test(`Script: ${name}`, () => {
    const result = observeScript(modules.main);
    expect(result.completion.Type).toBe(expected.status === 'fulfilled' ? 'normal' : 'throw');
    expect(result.bodyEntered).toBe(expected.bodyEntries!.length > 0);
    expect(result.errorClass).toBe(expected.errorClass);
    if (expected.diagnostic) expect(result.diagnostic).toMatchObject(expected.diagnostic);
    else expect(result.diagnostic).toBeUndefined();
  });
}
