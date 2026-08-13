import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

// Spec: sec-ordered-element-types.
//
// `sort` and `toSorted` compare by String when given no comparator, so
// `[].<uint8> = [10, 9, 1]` sorted to "1,10,9" while `Uint8Array` on the same
// input gave "1,9,10" - two array types with the same element type disagreeing.
// Where the element type carries an order, that order is used.
//
// Every input here DISCRIMINATES: string order and the correct order differ.
// Three shapes pass under the old behaviour by coincidence and are useless as
// tests - floats whose orders coincide, enums of ten or fewer members, and the
// NaN input [NaN, 1, -0, 0, -1].

test('the headline: a typed array agrees with its TypedArray', () => {
  const input = '[2, 10, 1, 20, 3]';
  const typed = evaluated(`let a: [].<uint8> = ${input}; a.sort(); a.join(",");`);
  const builtin = evaluated(`const a = new Uint8Array(${input}); a.sort(); a.join(",");`);
  expect(typed).toBe('1,2,3,10,20');
  expect(typed).toBe(builtin);
});

test('every numeric width and sign', () => {
  expect(evaluated('let a: [].<uint8> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
  expect(evaluated('let a: [].<uint16> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
  expect(evaluated('let a: [].<uint32> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
  // Signed: string order puts "-1" before "-10", value order does not.
  expect(evaluated('let a: [].<int8> = [-1, -10, 2]; a.sort(); a.join(",");')).toBe('-10,-1,2');
  expect(evaluated('let a: [].<int16> = [-1, -10, 2]; a.sort(); a.join(",");')).toBe('-10,-1,2');
  expect(evaluated('let a: [].<int32> = [-1, -10, 2]; a.sort(); a.join(",");')).toBe('-10,-1,2');
  // Floats, with an input whose string and numeric orders differ.
  expect(evaluated('let a: [].<float32> = [2.5, 10.5, 1.5]; a.sort(); a.join(",");')).toBe('1.5,2.5,10.5');
  expect(evaluated('let a: [].<float64> = [2.5, 10.5, 1.5]; a.sort(); a.join(",");')).toBe('1.5,2.5,10.5');
});

test('bigint compares as a BigInt, not through Number', () => {
  expect(evaluated('let a: [].<bigint> = [10n, 9n, 1n]; a.sort(); a.join(",");')).toBe('1,9,10');
  // Above 2**53, where converting to Number would give a wrong ORDER rather
  // than merely losing precision - the one case that is a wrong answer.
  expect(evaluated('let a: [].<bigint> = [9007199254740993n, 9007199254740992n]; a.sort(); a.join(",");')).toBe('9007199254740992,9007199254740993');
});

test('float NaN and -0 follow %TypedArray%.prototype.sort', () => {
  const input = '[NaN, 2, 10, 1]';
  const typed = evaluated(`let a: [].<float64> = ${input}; a.sort(); a.map(v => String(Number(v))).join(",");`);
  const builtin = evaluated(`const a = new Float64Array(${input}); a.sort(); Array.from(a).join(",");`);
  expect(typed).toBe('1,2,10,NaN');
  expect(typed).toBe(builtin);
  // -0 before +0.
  expect(evaluated('let a: [].<float64> = [0, -0]; a.sort(); a.map(v => Object.is(Number(v), -0) ? "-0" : "0").join(",");')).toBe('-0,0');
});

test('a numeric enum sorts by its ordinal', () => {
  // An enum whose underlying type is numeric holds typed numbers, so it reaches
  // the same comparison the numeric types do.
  //
  // The ordinals here are 2, 10, 1 - numeric order 1,2,10 against string order
  // 1,10,2. An input of 10, 1, 0 would pass under EITHER rule and prove nothing,
  // which is the trap this file's header warns about.
  const E = 'enum L: uint8 { A,B,C,D,E,F,G,H,I,J,K } ';
  expect(evaluated(`${E}let a: [].<L> = [L.C, L.K, L.B]; a.sort(); a.join(",");`)).toBe('1,2,10');
  // Identical to the plain numeric array of the same values.
  expect(evaluated('let a: [].<uint8> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
});

test('a 64-bit integral type compares at its own precision', () => {
  // `int64` holds values a double cannot tell apart: 9007199254740993 and
  // ...992 are the same Number. `numberValue()` narrows to that double - which
  // is exactly the information being lost - so the comparison reads the record's
  // exact value instead, the same one `String(x)` prints.
  expect(evaluated('let a: [].<int64> = [9007199254740993, 9007199254740992]; a.sort(); a.join(",");')).toBe('9007199254740992,9007199254740993');
  expect(evaluated('let a: [].<uint64> = [9007199254740993, 9007199254740992]; a.sort(); a.join(",");')).toBe('9007199254740992,9007199254740993');
  // Ordinary magnitudes are unaffected, as are the narrower widths.
  expect(evaluated('let a: [].<int64> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
  expect(evaluated('let a: [].<int32> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
});

test('a string enum sorts by declaration position', () => {
  // The design's own motivating case: "a sequence of named steps like time
  // units or severities is meant to compare in the order it's written, not
  // alphabetically". Sorting it alphabetically inverted the rule the design
  // promises, which makes this the strongest case for type-directed ordering -
  // the type does not merely know a faster order, it knows a DIFFERENT one.
  const T = 'enum T: string { Low = "low", Medium = "medium", High = "high" } ';
  expect(evaluated(`${T}let a: [].<T> = [T.High, T.Low, T.Medium]; a.sort(); a.join(",");`)).toBe('low,medium,high');
  // Values chosen so declaration order is the REVERSE of alphabetical.
  const S = 'enum S: string { Alpha = "z", Beta = "a" } ';
  expect(evaluated(`${S}let a: [].<S> = [S.Beta, S.Alpha]; a.sort(); a.join(",");`)).toBe('z,a');
  expect(evaluated(`${S}let a: [].<S> = [S.Beta, S.Alpha]; a.toSorted().join(",");`)).toBe('z,a');
  // Bare strings are unaffected, so the rule reaches only enumerators.
  expect(evaluated('let a: [].<string> = ["z", "a"]; a.sort(); a.join(",");')).toBe('a,z');
});

test('a class sorts by its declared operator <', () => {
  // The last ordered kind. An earlier note claimed the comparison could not
  // reach a user function because it "cannot yield" - that was wrong:
  // `CompareArrayElements` is itself a generator and already calls the
  // caller-supplied comparator. Only the local helper was non-generator, which
  // was a choice rather than a constraint.
  //
  // Values 2, 10, 1: correct order 1,2,10 against string order 1,10,2.
  const M = 'class M { constructor(v) { this.v = v; } operator <(o: M) { return this.v < o.v; } } ';
  expect(evaluated(`${M}let a: [].<M> = [new M(2), new M(10), new M(1)]; a.sort(); a.map(m => m.v).join(",");`)).toBe('1,2,10');
  expect(evaluated(`${M}let a: [].<M> = [new M(2), new M(10), new M(1)]; a.toSorted().map(m => m.v).join(",");`)).toBe('1,2,10');
  // Equal elements compare equal rather than being ordered arbitrarily.
  expect(evaluated(`${M}let a: [].<M> = [new M(5), new M(5)]; a.sort(); a.map(m => m.v).join(",");`)).toBe('5,5');
  // A class declaring nothing keeps the String comparison.
  expect(evaluated('class N { constructor(v) { this.v = v; } } let a: [].<N> = [new N(2), new N(1)]; a.sort(); a.map(n => n.v).join(",");')).toBe('2,1');
  // An explicit comparator still wins.
  expect(evaluated(`${M}let a: [].<M> = [new M(1), new M(2)]; a.sort((x, y) => y.v - x.v); a.map(m => m.v).join(",");`)).toBe('2,1');
});

test('the class comparison asks `<` once, or twice only when it must', () => {
  // `<` answers one bit where a sort needs three outcomes, so the operator may
  // be asked in both directions - but only when the first answer does not
  // settle it. `x < y` being true IS the answer, and the second call is skipped.
  //
  // Two elements is one comparison. Ordered so the first call answers:
  const settled = 'let n = 0; class M { constructor(v) { this.v = v; } operator <(o: M) { n = n + 1; return this.v < o.v; } } '
    + 'let a: [].<M> = [new M(2), new M(1)]; a.sort(); String(n);';
  expect(evaluated(settled)).toBe('1');
  // Ordered so the first call returns false and the direction must be checked:
  const unsettled = 'let n = 0; class M { constructor(v) { this.v = v; } operator <(o: M) { n = n + 1; return this.v < o.v; } } '
    + 'let a: [].<M> = [new M(1), new M(2)]; a.sort(); String(n);';
  expect(evaluated(unsettled)).toBe('2');
  // So the worst case is two calls per comparison and the common case is fewer.
  // A three-way operator would make it always one, which is the concrete
  // argument for adding one - not the halving of sort cost claimed earlier.
});

test('the types that already sorted correctly still do', () => {
  expect(evaluated('let a: [].<string> = ["b", "a", "c"]; a.sort(); a.join(",");')).toBe('a,b,c');
  expect(evaluated('let a: [].<boolean> = [true, false]; a.sort(); a.join(",");')).toBe('false,true');
});

test('nothing else changes', () => {
  // An untyped array keeps ECMA-262 behaviour, which programs depend on.
  expect(evaluated('const a = [10, 9, 1]; a.sort(); a.join(",");')).toBe('1,10,9');
  // An explicit comparator wins over the element type.
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; a.sort((x, y) => Number(y) - Number(x)); a.join(",");')).toBe('3,2,1');
  // toSorted takes the same path and does not mutate.
  expect(evaluated('let a: [].<uint8> = [2, 10, 1]; const b = a.toSorted(); b.join(",") + "|" + a.join(",");')).toBe('1,2,10|2,10,1');
  // Sorting preserves element typing and returns the same array.
  expect(evaluated('let a: [].<uint8> = [2, 1]; const b = a.sort(); String(b === a) + "/" + String(a[0] is uint8);')).toBe('true/true');
  // A fixed-length array sorts in place.
  expect(evaluated('let a: [3].<uint8> = [2, 10, 1]; a.sort(); a.join(",");')).toBe('1,2,10');
});
