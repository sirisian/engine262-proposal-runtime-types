import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { observeModuleGraph, type ModuleObservation } from '../module-observer.mts';

// #sec-resolve-reflected-type: relations accept the actual class denotation,
// including specialized constructors, without changing the relation itself.
const corpus = JSON.parse(readFileSync(new URL('../conformance/constructor-type-inputs.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  expect(result.errorClass).toBeUndefined();
  expect(result.diagnostic).toBeUndefined();
});

test.each([
  ['assignability target', 'Reflect.isAssignable(C.<string>, 42)', '42'],
  ['matching subject', 'Reflect.matchType(C.<string>, 42)', '42'],
  ['first invalid input', 'Reflect.isAssignable(41, 42)', '41'],
])('%s reports the original invalid operand', (_name, expression, invalid) => {
  const result = observeScript(`class C<T:type>{} ${expression};`);
  expect(result.bodyEntered).toBe(true);
  expect(result.errorClass).toBe('TypeError');
  expect(result.diagnostic).toBeUndefined();
  expect((result.completion.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString)
    .toBe(`TypeError: ${invalid} is not a type`);
});
