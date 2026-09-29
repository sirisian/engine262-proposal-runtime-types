import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// Early errors found in round 2 of the early-error review. Each is determinable
// before the source runs, so by #sec-type-errors it is an Early Error.

// -- a type default's value copies ---------------------------------------------
// #sec-array-and-tuple-types, #sec-object-types, #sec-function-types: a default
// is interned with its type, so its value must copy. Evaluability alone cannot
// ensure that: a compile-time-evaluable function may allocate.
test.each([
  'type T = [object = {}];',
  'type U = { c?: any = [] };',
  'interface I { a?: object = {}; }',
  'type F = (a: object = {}) => void;',
  'function mk() { return []; } type V = [any = mk()];',
  'type W = [any = /x/];',
  'type X = [any = () => 1];',
])('an allocating type default is refused: %s', expectStaticTypeError);

test.each([
  'type T = [[2].<uint8> = [1, 2]];',
  'function g(): uint8 { return 1; } type T = [uint8 = g(), string = "a"];',
  'type U = { c?: uint8 = 0 };',
  'enum E { A, B } type U = { e?: E = E.B };',
])('a default that copies is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- an established ToString stage over Symbols --------------------------------
// #sec-proved-library-operations: "At an established implicit ToString stage of
// a proved library operation, a participating operand necessarily containing
// only Symbols is a type error." Proved by origin, not by a list.
const S = 'const s: symbol = Symbol(); ';
test.each([
  `${S}const t: [symbol] = [s]; t.join();`,
  `${S}const f: [1].<symbol> = [s]; f.join();`,
  `${S}const u: [symbol, symbol] = [s, s]; u.toString();`,
  `${S}'x'.concat(s);`,
  `${S}'x'.concat('a', s);`,
  `${S}'abc'.startsWith(s);`,
  `${S}'abc'.endsWith(s);`,
  `${S}'abc'.indexOf(s);`,
  `${S}'abc'.lastIndexOf(s);`,
  `${S}'abc'.localeCompare(s);`,
  `${S}'x'.padStart(3, s);`,
  `${S}'x'.padEnd(3, s);`,
  `${S}parseInt(s);`,
  `${S}parseFloat(s);`,
  `${S}encodeURIComponent(s);`,
  `${S}decodeURI(s);`,
])('a Symbol at an established ToString stage is refused: %s', expectStaticTypeError);

test.each([
  // A growable array may be empty, so its element stage is not established.
  `${S}const g: [].<symbol> = [s]; try { g.join(); } catch {} "ok";`,
  // The filler is converted only where the target length exceeds the receiver's.
  `${S}String('xyz'.padStart(2, s));`,
  // A program's own parseInt is not the intrinsic.
  `function parseInt(x) { return 1; } ${S}String(parseInt(s));`,
  `String('x'.concat('a', 1));`,
  'const t: [uint8, uint8] = [1, 2]; String(t.join());',
  `${S}const a: [].<symbol> = [s]; String(a.toLocaleString());`,
])('a stage that is not established, or not over Symbols, is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- a `case` is the `v === e` row ---------------------------------------------
// #sec-narrowing and #sec-narrowfrom: a literal label the discriminant's type can
// never hold is a test that can never succeed, as `x === 300` is.
const X = 'const x: uint8 = 1; ';
test.each([
  `${X}switch (x) { case 300: break; default: break; }`,
  `${X}switch (x) { case -1: break; default: break; }`,
  `${X}switch (x) { case 1.5: break; default: break; }`,
  `const y: string = 'a'; switch (y) { case 1: break; default: break; }`,
])('a case label that can never match is refused: %s', expectStaticTypeError);

test.each([
  `${X}let r = 0; switch (x) { case 1: r = 1; break; case 255: break; default: break; } String(r);`,
  'let z = 1; switch (z) { case 300: break; default: break; }',
  `const y: string = 'a'; switch (y) { case 'a': break; default: break; }`,
])('a case label that can match is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- `Object.is` as a search-style test ----------------------------------------
test.each([
  `${X}if (Object.is(x, 300)) {}`,
  `${X}const w: string = 'a'; Object.is(x, w);`,
])('an Object.is that can never be true is refused: %s', expectStaticTypeError);

test.each([
  `${X}String(Object.is(x, 1));`,
  'String(Object.is(1, 300));',
  'const f: float64 = 0; String(Object.is(f, -0));',
])('an Object.is that can be true is accepted: %s', (source) => expect(ok(source)).toBe(true));
