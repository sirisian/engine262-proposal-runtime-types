import { test, expect } from 'vitest';
import {
  evaluated, expectError, expectThrown, runFlagOff,
} from '../readme/harness.mts';

/**
 * User-defined index operator dispatch (read direction).
 *
 * A class may declare an index operator `operator[](i)`. A numeric index access
 * `m[i]` on an instance of such a class dispatches to that operator, called with
 * the index value, in place of the ordinary property read (README
 * "Multidimensional and Jagged Array Support Via User-defined Index Operators",
 * spec sec-class-operators). The index may be a plain number or a typed numeric
 * value. A non-numeric key, such as a string method name, is left to ordinary
 * property access, so an index-defining class keeps its methods reachable. A class
 * with no index operator is unaffected, and the dispatch is gated on the feature.
 *
 * The write direction is covered below. Deferred and not covered here: the
 * multi-argument form `m[x, y]` (which needs the comma-index grammar of the ranges
 * extension), and overload resolution among several index operators.
 */

// -- Read dispatch -------------------------------------------------------------
test('a numeric index access dispatches to the class index operator', () => {
  expect(evaluated('class M { operator[](i) { return 42; } } let m = new M(); String(m[0]);')).toBe('42');
});

test('the index value is passed to the operator', () => {
  expect(evaluated('class M { operator[](i) { return i * 10; } } let m = new M(); String(m[5]);')).toBe('50');
});

test('a typed numeric index dispatches as well', () => {
  expect(evaluated('class M { operator[](i: uint32) { return (99 := uint32); } } let m = new M(); String(m[(0 := uint32)]);')).toBe('99');
});

test('the operator body sees this', () => {
  expect(evaluated('class M { constructor() { this.d = [10, 20, 30]; } operator[](i) { return this.d[i]; } } let m = new M(); String(m[2]);')).toBe('30');
});

// -- The operator is inherited -------------------------------------------------
test('an index operator declared on a base class dispatches for a subclass instance', () => {
  expect(evaluated('class B { operator[](i) { return i + 1; } } class D extends B {} let d = new D(); String(d[4]);')).toBe('5');
});

// -- Non-numeric keys fall through ---------------------------------------------
test('a string key reaches an ordinary method, not the index operator', () => {
  expect(evaluated('class M { operator[](i) { return 1; } foo() { return 7; } } let m = new M(); String(m["foo"]());')).toBe('7');
});

test('a computed string key falls through to ordinary property access', () => {
  expect(evaluated('class M { operator[](i) { return 1; } constructor() { this.name = "x"; } } let m = new M(); let k = "name"; m[k];')).toBe('x');
});

// -- Classes without an index operator -----------------------------------------
test('a class with no index operator performs an ordinary numeric property read', () => {
  expect(evaluated('class M { constructor() { this[0] = 99; } } let m = new M(); String(m[0]);')).toBe('99');
});

// -- Feature off ---------------------------------------------------------------
test('with the feature off, a numeric access is an ordinary property read', () => {
  // without the feature there are no index operators; a plain object read is itself
  const c = runFlagOff('let o = { 0: 7 }; String(o[0]);') as { Type: string, Value: { stringValue?(): string } };
  expect(c.Type).toBe('normal');
  expect(c.Value.stringValue?.()).toBe('7');
});

// -- The write half of the index accessor --------------------------------------
const PAIR = 'class M { constructor() { this.v = []; } get operator[](i) { return this.v[i] ?? 0; } set operator[](i, val) { this.v[i] = val * 2; } } ';

test('index operator: a write dispatches to the class set operator[]', () => {
  // the setter takes the index first and the value last, so the write reaches the
  // class rather than creating an ordinary property
  expect(evaluated(PAIR + 'let m = new M(); m[1] = 5; String(m.v[1]);')).toBe('10');
  // and the read half reads back what the write half stored
  expect(evaluated(PAIR + 'let m = new M(); m[2] = 7; String(m[2]);')).toBe('14');
  // the read half still works on its own
  expect(evaluated(PAIR + 'let m = new M(); m.v[3] = 30; String(m[3]);')).toBe('30');
});

test('index operator: a read accessor with no write half reports the write', () => {
  // the write would reach nothing the read will ever look at, so it is reported
  // rather than silently stored on an ordinary property
  expectThrown('class R { constructor() { this.v = []; } get operator[](i) { return this.v[i] ?? 0; } } let x = new R(); x[0] = 5;');
  // a plain operator[] with no prefix is the read half, and behaves the same way
  expectThrown('class M { operator[](i) { return i * 10; } } let m = new M(); m[0] = 5;');
  // reading is unaffected
  expect(evaluated('class M { operator[](i) { return i * 10; } } let m = new M(); String(m[4]);')).toBe('40');
});

test('index operator: ordinary indexing is untouched', () => {
  expect(evaluated('let a = [1, 2, 3]; a[1] = 9; String(a[1]);')).toBe('9');
  expect(evaluated('let o = {}; o[0] = 5; String(o[0]);')).toBe('5');
  expect(evaluated('String("abc"[1]);')).toBe('b');
});

// -- #sec-class-operators: a computed access may supply several indices --------
const GRID = 'class C { #d = [0, 0, 0, 0];'
  + ' get operator[](x: uint32, y: uint32) { return this.#d[y * 2 + x]; }'
  + ' set operator[](x: uint32, y: uint32, v) { this.#d[y * 2 + x] = v; } } ';

test('a multi-index access reaches an accessor of that many parameters', () => {
  // the design's `grid[x, y]`, which is what the multidimensional section is for
  expect(evaluated('class C { get operator[](x: uint32, y: uint32) { return (x * 10 + y) := uint32; } } String(new C()[1, 2]);')).toBe('12');
  expect(evaluated(`${GRID}const c = new C(); c[1, 1] = 9; String(c[1, 1]);`)).toBe('9');
  // three indices, the 4x4x4 grid of the same section
  expect(evaluated('class C { #d = [];'
    + ' get operator[](x: uint32, y: uint32, z: uint32) { return this.#d[z * 4 + y * 2 + x]; }'
    + ' set operator[](x: uint32, y: uint32, z: uint32, v) { this.#d[z * 4 + y * 2 + x] = v; } }'
    + ' const c = new C(); c[1, 1, 1] = 7; String(c[1, 1, 1]);')).toBe('7');
});

test('accessors of different index counts coexist on one class', () => {
  // keyed by name alone, the second declaration overwrote the first and only
  // one of them was ever reachable
  expect(evaluated('class C { #d = [0, 0, 0, 0];'
    + ' get operator[](i: uint32) { return this.#d[i]; }'
    + ' set operator[](i: uint32, v) { this.#d[i] = v; }'
    + ' get operator[](x: uint32, y: uint32) { return this.#d[y * 2 + x]; }'
    + ' set operator[](x: uint32, y: uint32, v) { this.#d[y * 2 + x] = v; } }'
    + ' const c = new C(); c[0] = 5; c[1, 1] = 9; String(c[0]) + "," + String(c[1, 1]);')).toBe('5,9');
});

test('where no accessor applies the base language reading stands', () => {
  // the brackets hold one expression, so the key is the last operand's value
  expect(evaluated('let a = [10, 20, 30]; String(a[1, 2]);')).toBe('30');
  expect(evaluated('class C { } const c = new C(); c[2] = "x"; String(c[1, 2]);')).toBe('x');
  // an index of another kind keeps the access ordinary, so methods stay reachable
  expect(evaluated('class C { get operator[](i: uint32) { return 99; } m() { return 5; } }'
    + ' const c = new C(); String(c["m"]());')).toBe('5');
});

test('every index is evaluated in order whichever reading applies', () => {
  // the property that makes the fallback invisible: the effects are the same
  // and only the value used differs
  expect(evaluated('let log = ""; function f(v) { log += v; return v; }'
    + ' class C { get operator[](x: uint32, y: uint32) { return (x + y) := uint32; } }'
    + ' const r = new C()[f(1), f(2)]; log + ":" + String(r);')).toBe('12:3');
  expect(evaluated('let log = ""; function f(v) { log += v; return v; }'
    + ' let a = [0, 0, 0]; a[f(1), f(2)]; log;')).toBe('12');
});

test('a parenthesized comma supplies one index', () => {
  expect(evaluated('class C { get operator[](i: uint32) { return (i * 10) := uint32; }'
    + ' get operator[](x: uint32, y: uint32) { return (999) := uint32; } }'
    + ' String(new C()[(1, 2)]);')).toBe('20');
});

test('multi-index access is inert with the feature off', () => {
  expect(runFlagOff('let a = [10, 20, 30]; a[1, 2];')).toMatchObject({ Type: 'normal' });
});

// -- #sec-class-operators: a ref read direction serves writes ------------------
const REFGET = 'class C { #d = [1, 2]; get operator[](i: uint32) { return ref this.#d[i]; } peek(i) { return this.#d[i]; } } ';

test('a write goes through a borrow the read direction returned', () => {
  // the design writes `get operator[]() { return ref this[...]; }` with no
  // setter, because a reference already denotes the place a write goes
  expect(evaluated(`${REFGET}const c = new C(); c[0] = 5; String(c.peek(0));`)).toBe('5');
  // and reading still decays, so a value use sees the referent
  expect(evaluated(`${REFGET}String(new C()[1]);`)).toBe('2');
  // several indices work the same way
  expect(evaluated('class C { #d = [0, 0, 0, 0];'
    + ' get operator[](x: uint32, y: uint32) { return ref this.#d[y * 2 + x]; }'
    + ' peek(i) { return this.#d[i]; } }'
    + ' const c = new C(); c[1, 1] = 9; String(c.peek(3));')).toBe('9');
});

test('a borrowed index supports read-modify-write', () => {
  expect(evaluated(`${REFGET}const c = new C(); c[0] += 10; String(c.peek(0));`)).toBe('11');
  expect(evaluated(`${REFGET}const c = new C(); c[0]++; String(c.peek(0));`)).toBe('2');
  expect(evaluated(`${REFGET}const c = new C(); c[0] ||= 7; String(c.peek(0));`)).toBe('1');
});

test('a write direction is used where one is declared', () => {
  // paired with a VALUE read direction, which is the combination that stays
  // legal: pairing one with a `ref` read direction is refused below, since the
  // borrow already denotes where the write goes
  expect(evaluated('let via = ""; class C { #d = [1];'
    + ' get operator[](i: uint32) { return this.#d[i]; }'
    + ' set operator[](i: uint32, v) { via = "setter"; this.#d[i] = v; } }'
    + ' const c = new C(); c[0] = 7; via;')).toBe('setter');
});

test('a read direction yielding a value still cannot serve a write', () => {
  // there is no location for the write to reach, so it would not be read back
  expectThrown('class C { #d = [1]; get operator[](i: uint32) { return this.#d[i]; } } new C()[0] = 5;');
});

test('a write through a borrowed index is checked as the element requires', () => {
  expect(evaluated('class C { d: [].<uint8> = [1, 2];'
    + ' get operator[](i: uint32) { return ref this.d[i]; } }'
    + ' const c = new C(); c[0] = 200; String(c.d[0]);')).toBe('200');
  expectThrown('class C { d: [].<uint8> = [1];'
    + ' get operator[](i: uint32) { return ref this.d[i]; } }'
    + ' const c = new C(); c[0] = 300;');
});

test('a class may not declare both a ref read direction and a write direction', () => {
  // the borrow already denotes where the write goes, so a setter for the same
  // number of indices would give the write two meanings
  expectError('class C { #d = [1]; get operator[](i: uint32) { return ref this.#d[i]; }'
    + ' set operator[](i: uint32, v) { this.#d[i] = v; } } "ran";');
  // in either declaration order
  expectError('class C { #d = [1]; set operator[](i: uint32, v) { this.#d[i] = v; }'
    + ' get operator[](i: uint32) { return ref this.#d[i]; } } "ran";');
  // and however the read direction says it yields a reference
  expectError('class C { #d = [1]; get operator[](i: uint32): ref uint32 { return ref this.#d[i]; }'
    + ' set operator[](i: uint32, v) { this.#d[i] = v; } } "ran";');
});

test('the pair is refused only where it is actually ambiguous', () => {
  // a read direction yielding a VALUE needs its write direction
  expect(evaluated('class C { #d = [1]; get operator[](i: uint32) { return this.#d[i]; }'
    + ' set operator[](i: uint32, v) { this.#d[i] = v; } }'
    + ' const c = new C(); c[0] = 7; String(c[0]);')).toBe('7');
  // a reference read direction alone is the design's own form
  expect(evaluated('class C { #d = [1]; get operator[](i: uint32) { return ref this.#d[i]; }'
    + ' peek(i) { return this.#d[i]; } }'
    + ' const c = new C(); c[0] = 7; String(c.peek(0));')).toBe('7');
  // directions for different numbers of indices do not collide
  expect(evaluated('class C { #d = [1, 2, 3, 4];'
    + ' get operator[](i: uint32) { return ref this.#d[i]; }'
    + ' set operator[](x: uint32, y: uint32, v) { this.#d[y * 2 + x] = v; }'
    + ' peek(i) { return this.#d[i]; } }'
    + ' const c = new C(); c[0] = 9; c[1, 1] = 8; String(c.peek(0)) + "," + String(c.peek(3));')).toBe('9,8');
  // a return inside a nested function is not this accessor's return
  expect(evaluated('class C { #d = [1];'
    + ' get operator[](i: uint32) { const f = () => 1; return this.#d[i]; }'
    + ' set operator[](i: uint32, v) { this.#d[i] = v; } }'
    + ' const c = new C(); c[0] = 4; String(c[0]);')).toBe('4');
});
