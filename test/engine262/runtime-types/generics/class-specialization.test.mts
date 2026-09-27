import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Phase 5, slice 1: class specializations (plan 6.3). A CASE - a class
// declaration whose list specializes its family - supplies a complete body,
// selected per application by the rule function cases use, and keeps the
// primary's public contract.

const P = 'class Box<T: type> { v: T; constructor(v: T) { this.v = v; } get kind(): string { return "primary"; } } ';
const PACKED = 'class Box<boolean> { v: boolean; bits: uint8; constructor(v: boolean) { this.v = v; this.bits = v ? 1 : 0; } get kind(): string { return "packed"; } } ';

test('an application selects the case\'s complete body, or the primary\'s', () => {
  expect(evaluated(`${P}${PACKED} new Box.<boolean>(true).kind + "," + new Box.<uint8>((1 := uint8)).kind;`)).toBe('packed,primary');
  // Its own representation: a member the primary does not declare.
  expect(evaluated(`${P}${PACKED} String(new Box.<boolean>(true).bits);`)).toBe('1');
});

test('the application keeps the family\'s identity, one stable definition', () => {
  expect(evaluated(`${P}${PACKED} String(Reflect.typeOf(new Box.<boolean>(true)));`)).toBe('Box.<boolean>');
  expect(evaluated(`${P}${PACKED} String((Box.<boolean>) === (Box.<boolean>));`)).toBe('true');
  expect(evaluated(`${P}${PACKED} String(new Box.<boolean>(true) instanceof Box.<boolean>);`)).toBe('true');
  // One binding: a case declares no name of its own.
  expect(evaluated(`${P}${PACKED} typeof Box;`)).toBe('function');
});

test('a case is inert where it is written: its body is evaluated once, when selected', () => {
  expect(evaluated('globalThis.ran = 0; class Box<T: type> { static { globalThis.ran += 1; } } '
    + 'class Box<boolean> { static { globalThis.ran += 10; } } const before = globalThis.ran; Box.<boolean>; Box.<boolean>; '
    + 'String(before) + "," + String(globalThis.ran);')).toBe('0,10');
});

test('a capture\'s bound is enforced in selection, for classes and functions alike', () => {
  // The host's bound check was a stub that admitted every argument.
  expect(evaluated('class B<T: type> { get k(): string { return "p"; } } class B<const T: type extends [].<any>> { get k(): string { return "arr"; } } '
    + 'new B.<[].<uint8>>().k + "," + new B.<string>().k;')).toBe('arr,p');
  expect(evaluated('function f<T: type>(): string { return "p"; } function f<const T: type extends [].<any>>(): string { return "arr"; } '
    + 'f.<[].<uint8>>() + "," + f.<string>();')).toBe('arr,p');
});

test('a case belongs to the primary declared in its own statement list', () => {
  expectThrown('class B<uint8> {}', 'no `class B<...>` in this statement list declares the family it would specialize');
  expectThrown('{ class Box<T: type> {} } class Box<uint32> {}', 'no `class Box<...>` in this statement list');
  expectThrown('class Pair<const T, T> {}', 'a capture, `const T`, belongs to a specialization list');
  // An additive partial class, and a class expression, may not specialize.
  expectThrown('partial class Box<boolean> {}', 'has no domain');
  expectThrown('class Box<T: type> {} const X = class Box<boolean> {};', 'declares parameters only');
});

test('a case keeps the primary\'s public contract after substitution', () => {
  expectThrown(`${P} class Box<boolean> { v: boolean; constructor(v: boolean) { this.v = v; } }`, 'it has no `kind`');
  expectThrown(`${P} class Box<boolean> { v: boolean; constructor(v: boolean) { this.v = v; } get kind(): uint8 { return (1 := uint8); } }`,
    'its `kind` is uint.<8>, not assignable to string');
  expectThrown(`${P} class Box<boolean> { get kind(): string { return "x"; } constructor(v: boolean) {} }`, 'it has no `v`');
  expectThrown(`${P} class Box<boolean> { v: boolean; constructor(v: string) { this.v = true; } get kind(): string { return "x"; } }`,
    'its constructor does not accept (boolean)');
});
