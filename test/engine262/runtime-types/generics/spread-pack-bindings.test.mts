import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

// #sec-bindtypearguments: an unexpanded argument run is not an empty pack.
const capture = 'function capture<...Ts: [].<type>>(...xs: Ts): string { return String(Ts); } ';

test('a tuple spread binds every contributed runtime type', () => {
  expect(evaluated(capture + 'const xs: [uint8, string] = [1, "a"]; capture(...xs);')).toBe('[uint.<8>, string]');
  expect(evaluated(capture + 'const xs: [] = []; capture(...xs);')).toBe('[]');
});

test('a spread preserves preceding arguments in the inferred pack', () => {
  expect(evaluated(capture + 'const xs: [uint8, string] = [1, "a"]; capture(true, ...xs);')).toBe('[boolean, uint.<8>, string]');
});

test('a generic wrapper forwards its complete pack', () => {
  expect(evaluated(capture + 'function forward<...Ts: [].<type>>(...xs: Ts): string { return capture(...xs); } '
    + 'forward((1 := uint8), "a", true);')).toBe('[uint.<8>, string, boolean]');
});

test('an unknown spread retains the runtime reference requirement for its prefix', () => {
  expectThrownKind('function f(ref x: uint8, ...xs: [].<any>) {} '
    + 'function invoke(xs: [].<any>) { let n: uint8 = 1; f(n, ...xs); } invoke([]);', 'TypeError');
});
