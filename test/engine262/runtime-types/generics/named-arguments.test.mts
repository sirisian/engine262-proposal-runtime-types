// Named type arguments bind by NAME at every application site - class types in type
// position, `new`, heritage, explicit calls, methods, statics, generators,
// async functions, expression-position aliases, and library generics - not only
// for a generic alias in type position. Before this a correct name was silently
// mis-positioned (the argument landed in position 0), which is the exact
// failure the unknown-name rule exists to prevent.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const GRID = 'class Grid<T = float64, Cols = uint8> { t: T = 1; c: Cols = 1; }';
const BUFFER = "class Buffer<T = uint8, Size: uint32 = 256, Name: string = 'buf'> { size(): uint32 { return Size; } label(): string { return Name; } }";

// A.B - classes.
test('a named argument reaches its class parameter in TYPE position (B7)', () => {
  // Before: `Grid.<Cols: uint16>` resolved as `Grid.<uint16>` - T took the
  // argument and the annotation refused its own value.
  expect(evaluated(`${GRID} let g: Grid.<Cols: uint16> = new Grid.<float64, uint16>(); String(g.c is uint16);`)).toBe('true');
});

test('a named argument reaches its class parameter through `new` (B1, B2)', () => {
  expect(evaluated(`${BUFFER} String(new Buffer.<Size: 1024>().size());`)).toBe('1024');
  expect(evaluated(`${BUFFER} String(new Buffer.<Size: 1024>().label());`)).toBe('buf');
});

test('names in any order, mixed with positional (B3, B4)', () => {
  expect(evaluated(`${BUFFER} const b = new Buffer.<float32, Name: 'audio'>(); String(b.label()) + '/' + String(b.size());`)).toBe('audio/256');
  expect(evaluated(`${BUFFER} const b = new Buffer.<Name: 'a', Size: 2, T: uint16>(); String(b.size());`)).toBe('2');
});

test('one specialization under two spellings (B5)', () => {
  expect(evaluated(`${BUFFER} String(Buffer.<Size: 1024> === Buffer.<uint8, 1024, 'buf'>);`)).toBe('true');
  expect(evaluated(`${BUFFER} String(Buffer.<Size: 1024> !== Buffer.<Size: 1025>);`)).toBe('true');
});


test('heritage takes the same list (B17)', () => {
  expect(evaluated(`${BUFFER} class Audio extends Buffer.<float32, Name: 'audio'> {} String(new Audio().label());`)).toBe('audio');
});

test('the named-argument error surface on a class (B12, B13, B14, B15, B16)', () => {
  expectThrown(`${BUFFER} new Buffer.<Sizee: 1>();`, 'does not name a type parameter');
  expectThrown(`${BUFFER} new Buffer.<Size: 1, Size: 2>();`, 'supplied twice');
  expectThrown(`${BUFFER} new Buffer.<uint8, T: uint16>();`, 'supplied twice');
  expectThrown(`${BUFFER} new Buffer.<Size: 1, uint8>();`, 'positional type argument cannot follow');
  expectThrown(`${BUFFER} new Buffer.<Size: 'x'>();`);  // CheckedConvertValue's own wording; the refusal is what's pinned
});

test('an unnamed middle parameter with a default is filled, not skipped (B4 shape)', () => {
  // Ordering leaves a HOLE at Size, which takes its default under the same
  // frame the positional path uses.
  expect(evaluated(`${BUFFER} String(new Buffer.<Name: 'n'>().size());`)).toBe('256');
});

// A.C - functions, methods, statics, generators, async.
const FILL = 'function fill<T = uint8, N: uint32 = 4, V: T = 0>(): uint32 { return N; }';

test('a named argument reaches its function parameter (C1)', () => {
  // Before: `fill.<N: 8>()` bound T to the literal type 8 and N kept its
  // default - the probe read 4.
  expect(evaluated(`${FILL} String(fill.<N: 8>());`)).toBe('8');
});

test('a later constraint reads an earlier NAMED binding (C2 shape)', () => {
  expect(evaluated("function f<T = uint8, V: T = 0>(): T { return V; } String(Reflect.typeOf(f.<T: float32, V: 1.5>()));")).toBe('float32');
});

test('the error surface on a call (C3, C5, C6, C7, C8)', () => {
  expectThrown(`${FILL} fill.<V: 'x'>();`);  // as above
  expectThrown(`${FILL} fill.<Nn: 8>();`, 'does not name a type parameter');
  expectThrown(`${FILL} fill.<N: 8, N: 9>();`, 'supplied twice');
  expectThrown(`${FILL} fill.<uint8, T: uint8>();`, 'supplied twice');
  expectThrown(`${FILL} fill.<N: 8, uint16>();`, 'positional type argument cannot follow');
});

test('a required type parameter a named list leaves out is reported by name', () => {
  expectThrown('function g<T, N: uint32 = 1>(): uint32 { return N; } g.<N: 2>();', 'has no argument and no default');
});

test('methods, statics, generators, and async functions take names (C11, C13, C14)', () => {
  expect(evaluated("class S { get<T = string, Fallback: T = 'd'>(): T { return Fallback; } static of<T, N: uint32 = 1>(): uint32 { return N; } *walk<T, Step: uint32 = 1>() { yield Step; } } String(new S().get.<Fallback: 'none'>());")).toBe('none');
  expect(evaluated('class S { static of<T, N: uint32 = 1>(): uint32 { return N; } } String(S.of.<uint8, N: 3>());')).toBe('3');
  expect(evaluated('class S { *walk<T, Step: uint32 = 1>() { yield Step; } } String(new S().walk.<uint8, Step: 2>().next().value);')).toBe('2');
});

test('function and generator expressions take names (C16, C17)', () => {
  expect(evaluated('const fe = function <T = uint8, N: uint32 = 1>(): uint32 { return N; }; String(fe.<N: 2>());')).toBe('2');
  expect(evaluated('const ge = function* <T, N: uint32 = 1>() { yield N; }; String(ge.<uint8, N: 3>().next().value);')).toBe('3');
});

test("a method's list does not admit the class's parameter names (C21, C22)", () => {
  const V = 'class V<T, N: uint32> { lane<I: uint32>(): uint32 { return I; } }';
  expectThrown(`${V} new V.<uint8, 4>().lane.<T: uint8>();`, 'does not name a type parameter');
  expectThrown(`${V} new V.<uint8, 4>().lane.<N: 2>();`, 'does not name a type parameter');
  expect(evaluated(`${V} String(new V.<uint8, 4>().lane.<I: 1>());`)).toBe('1');
});

// A.A - aliases in both positions, and library generics.
test('an alias honours names in EXPRESSION position as it does in type position (A7 shape)', () => {
  const T = 'type Grid<T = float64, Rows: uint32 = 4, Cols: uint32 = 4> = [Cols].<T>;';
  expect(evaluated(`${T} String(Grid.<Cols: 8> === Grid.<float64, 4, 8>);`)).toBe('true');
});


test('library ordering is enforced, not decorative (A27 boundary)', () => {
  expectThrown("let m: Map.<V: uint8, K: string> = new Map(); m.set(1, 'k');", 'is not assignable');
});



// Regressions: the positional paths are untouched.
test('positional applications keep their exact behaviour and messages (A37)', () => {
  expect(evaluated(`${BUFFER} String(new Buffer.<uint8, 2>().size());`)).toBe('2');
  expect(evaluated(`${FILL} String(fill.<uint8, 8>());`)).toBe('8');
  expectThrown('function g<T>(): uint32 { return 1; } g.<>();', 'type arguments');
});

test('annotation and construction agree across spellings (B7 boundary)', () => {
  expect(evaluated(`${BUFFER} let c: Buffer.<Size: 1024> = new Buffer.<uint8, 1024>(); 'ok';`)).toBe('ok');
  expectThrown(`${BUFFER} let c: Buffer.<Size: 1024> = new Buffer.<Size: 512>();`, 'is not assignable');
});

test('library generics bind by the names the specification writes (A26, A27)', () => {
  // Before: `Map.<V: uint8, K: string>` was silently `Map.<uint8, string>`.
  expect(evaluated("let m: Map.<K: string, V: uint8> = new Map(); m.set('k', 1); String(m.size);")).toBe('1');
  expect(evaluated("let m: Map.<V: uint8, K: string> = new Map(); m.set('k', 1); String(m.size);")).toBe('1');
  expect(evaluated('let s: Set.<T: uint8> = new Set(); s.add(1); String(s.size);')).toBe('1');
});

test('an unknown name on a library generic is refused, not guessed (A29)', () => {
  expectThrown('let m: Map.<Z: uint8> = new Map();', 'does not name a type parameter');
});

test('a library generic whose required parameter a named list leaves out is reported (A26 shape)', () => {
  expectThrown('let m: Map.<V: uint8> = new Map();', 'has no argument and no default');
});
