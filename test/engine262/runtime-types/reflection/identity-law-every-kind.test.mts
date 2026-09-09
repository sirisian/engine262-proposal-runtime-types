import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-reflect-maketype's identity law, over every kind that can be written as a
 * type: a type reflected and rebuilt is the same type.
 *
 * Table-driven on purpose. `shared` was found by checking a claim asserted from a
 * partial sample - nine kinds measured, nineteen assumed - and the same grouping
 * in `nodeToTypeRecord` could have hidden another. It had: `range` metadata does
 * not round-trip either, and only a sweep over the whole list would have said so.
 */

const FORMS: readonly (readonly [string, string, string])[] = [
  ['any', '', 'type any'],
  ['void', '', 'type void'],
  ['never', '', 'never'],
  ['primitive', '', 'uint8'],
  ['literal', '', 'type "x"'],
  ['object', '', 'type { a: uint8, b: string }'],
  ['tuple', '', 'type [uint8, string]'],
  ['array', '', 'type [].<uint8>'],
  ['union', '', 'type uint8 | string'],
  ['intersection', '', 'type { a: uint8 } & { b: string }'],
  ['function', '', 'type (uint8) => string'],
  ['nominal', 'class C {}', 'C'],
  ['enum', 'enum E { a, b }', 'E'],
  ['type', '', 'type type'],
  ['parameterized', '', 'type uint32.<{ brand: "X" }>'],
  ['pattern metadata', '', 'type string.<{ pattern: /^a$/ }>'],
  ['shared', '', 'type shared uint32'],
  ['shared through an alias', 'type A = uint32;', 'type shared A'],
  ['parameter', 'let S = Reflect.inferSlot("S");', 'S'],
  ['application', 'function mk(T: type): type { return T; }', 'type mk(uint8)'],
  ['generic alias', 'type Box<T> = { v: T };', 'type Box.<uint8>'],
  // `reference` is internal to a recursive type and is exercised through one.
  ['reference', 'type L = { next: L | void };', 'L'],
];

for (const [kind, preamble, expression] of FORMS) {
  test(kind, () => {
    const source = `${preamble} String(Reflect.makeType(Reflect.getReflection(${expression})) === (${expression}));`;
    expect(`${kind}=${evaluated(source)}`).toBe(`${kind}=true`);
  });
}

test('shared keeps its marker, which is what the round trip was losing', () => {
  // The fix had to preserve the wrapper rather than satisfy the law by removing
  // it from reflection too: a tool must still be able to see that a type is
  // shared, and `shared T` and `T` are distinct types.
  expect(evaluated('type S = shared uint32; String(Reflect.getReflection(S).kind);')).toBe('shared');
  expect(evaluated('type S = shared uint32; String(Reflect.getReflection(S).target === uint32);')).toBe('true');
  expect(evaluated('type S = shared uint32; String(S === uint32);')).toBe('false');
});

// KNOWN GAP, pinned rather than hidden. A range carried as metadata does not
// round-trip: the rebuilt type reads `float64.<{ bounds: { __range: true, ... } }>`
// where the original reads `float64.<{ bounds: 0..<10 }>`, so the leaf is walked
// as an ordinary object instead of being rebuilt as a range. `bounds` needs a
// user `meta` declaration, which is why it took a preamble to reach at all.
test.fails('range metadata does not round-trip yet', () => {
  const meta = 'type NB = { bounds?: RangeBounds }; meta NB { default = {}; subtype(a,b){ return true; } } ';
  const declaration = 'type R = float64.<{ bounds: 0..<10 }>; ';
  expect(evaluated(`${meta}${declaration} String(Reflect.makeType(Reflect.getReflection(R)) === R);`)).toBe('true');
});
