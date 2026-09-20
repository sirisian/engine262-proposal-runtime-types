import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-range-literals. "That every end is written is what makes
 * `for (const i of 0..<array.length)` the loop written without thinking rather
 * than one short."
 *
 * That loop HUNG for a typed array. Two endpoint readers disagreed about what
 * counts as an endpoint: `endpointOf` unwraps a typed number, while
 * `numericEndpoint` - the one the ITERATOR uses - took only a plain
 * `NumberValue` and answered *undefined* for anything else. To `reachedEnd`,
 * *undefined* means UNBOUNDED, so it answered *false* forever and the range
 * iterated without end.
 *
 * A typed array's `length` is a `uint.<64>`, so the idiomatic loop was the
 * common path into it; the literal form `0..<3` was unaffected, which is why it
 * stayed hidden. A hang has no error to catch and no stack to read - it was
 * found because a probe batch produced no output at all.
 */

const A = 'let a: [].<uint8> = [(1 := uint8), (2 := uint8)]; ';

test('the loop the clause holds up terminates', () => {
  expect(evaluated(`${A}let n = 0; for (const i of 0..<a.length) { n++; } String(n);`)).toBe('2');
});

test('a typed endpoint of any width terminates', () => {
  expect(evaluated('let n = 0; let e = (3 := uint8); for (const i of 0..<e) { n++; } String(n);')).toBe('3');
  expect(evaluated('let n = 0; let e = (3 := uint64); for (const i of 0..<e) { n++; } String(n);')).toBe('3');
  expect(evaluated('let n = 0; let e = (3 := float64); for (const i of 0..<e) { n++; } String(n);')).toBe('3');
  // A closed range counts its endpoint, as it does for an untyped one.
  expect(evaluated('let n = 0; let e = (3 := uint8); for (const i of 0..=e) { n++; } String(n);')).toBe('4');
  // And a typed START was never the problem, but is pinned beside it.
  expect(evaluated('let s = (1 := uint8); let n = 0; for (const i of s..<4) { n++; } String(n);')).toBe('3');
});

test('the untyped and literal forms are unchanged', () => {
  expect(evaluated('let n = 0; for (const i of 0..<3) { n++; } String(n);')).toBe('3');
  expect(evaluated('let n = 0; let a = [1, 2]; for (const i of 0..<a.length) { n++; } String(n);')).toBe('2');
});

test('every other reader of a typed endpoint still agrees', () => {
  // `length` read the endpoint through `endpointOf` and was always right, which
  // is what made the disagreement between the two readers visible.
  expect(evaluated(`${A}String((0..<a.length).length);`)).toBe('2');
  expect(evaluated('let e = (3 := uint8); String([...0..<e].length);')).toBe('3');
});
