import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';

// #sec-isoftype and #sec-issignaturesubtype: an erased receiver does not erase
// its method's declared or published result. Membership never calls the method.
const corpus = JSON.parse(readFileSync(new URL('../conformance/callable-member-membership.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (expected.status === 'fulfilled') {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
