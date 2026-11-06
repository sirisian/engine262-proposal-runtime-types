import { test, expect } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

// #sec-type-references: a builder that reads a parameter of an enclosing
// declaration not yet bound defers its application, and the applied
// declaration's clauses that read it are judged when the enclosing declaration
// is specialized.

const D = 'function Inc(n: uint32): uint32 { return n + 1; } function g<N: uint32>(): string where N < 100 { return String(N); } function h<M: uint32>(): string { return g.<Inc(M)>(); } ';

test('a declaration whose deferred builder no specialization reaches is not refused', () => {
  expect(evaluated(`${D}'declared';`)).toBe('declared');
});

test('a specialization judges the clause with the builder\'s value', () => {
  expect(evaluated(`${D}h.<5>();`)).toBe('6');
  expect(observeScript(`${D}h.<200>();`).completion.Type).toBe('throw');
});
