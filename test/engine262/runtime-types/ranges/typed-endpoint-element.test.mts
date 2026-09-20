import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-range-literals, and the literal rule generally.
 *
 * A range literal's element type came from `contextualElement ?? start ?? end`,
 * so the FIRST endpoint won outright. A literal there carried its `number` base
 * past a genuinely typed endpoint opposite, and
 * `for (const i of 0..<array.length)` over a TYPED array - whose `length` is a
 * `uint.<64>` - was a range of `number`.
 *
 * That is the loop the clause holds up as "the loop written without thinking
 * rather than one short", and its index came out untyped, so it could not be
 * used where the element type was wanted.
 *
 * A literal adapts to its position everywhere else in this system, and the
 * opposite endpoint is the position here.
 */

test("a typed endpoint decides the element type, whichever side it is on", () => {
  // The clause's own loop: `length` is a `uint.<64>` on a typed array, so the
  // index is one too and reaches a `uint64` position.
  expect(evaluated('let a: [].<uint8> = [(1 := uint8),(2 := uint8)]; '
    + 'const st = new Set.<uint64>(); for (const i of 0..<a.length) st.add(i); String(st.size);')).toBe('2');
  // The same with an explicitly typed endpoint. `const` matters: a `let` has no
  // static type to contribute, "because a binding that may be reassigned must
  // have a type its assignments are checked against".
  expect(evaluated('const e = (3 := uint32); const st = new Set.<uint32>(); '
    + 'for (const i of 0..<e) st.add(i); String(st.size);')).toBe('3');
});

test('a contextual type still wins over both endpoints', () => {
  expect(evaluated('let r: ClosedOpenRange.<uint8> = 0..<3; const st = new Set.<uint8>(); '
    + 'for (const i of r) st.add(i); String(st.size);')).toBe('3');
});

test('two bare literals are still a range of number', () => {
  // Nothing supplies an element type here, so the literal rule has no position
  // to adapt to and `number` is the answer.
  expect(evaluated('const st = new Set.<number>(); for (const i of 0..<3) st.add(i); String(st.size);')).toBe('3');
  expect(evaluated('let n = 0; for (const i of 0..<3) n++; String(n);')).toBe('3');
});

test('iteration itself is unchanged', () => {
  expect(evaluated('let a: [].<uint8> = [(1 := uint8),(2 := uint8)]; '
    + 'let n = 0; for (const i of 0..<a.length) n++; String(n);')).toBe('2');
  expect(evaluated("let s = ''; for (const i of (0..<10).step(3)) { s += String(i) + ';'; } s;")).toBe('0;3;6;9;');
  expect(evaluated('String((0..=4).length);')).toBe('5');
});
