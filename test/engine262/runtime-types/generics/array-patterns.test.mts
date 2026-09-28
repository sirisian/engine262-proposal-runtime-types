import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Array patterns in specialization lists: `[].<const E>` matches a dynamic
// array and captures its element, `[const N].<const E>` a fixed one and
// captures its extent as a value, `[4].<const E>` a fixed array of extent 4.
// The engine's pattern host returned null for every array, so no array case
// was ever selected, for any kind of declaration; and the fixed parts nested
// in array and tuple patterns were never resolved, so some of them crashed.

const F = 'function f<T: type>(): string { return "p"; } '
  + 'function f<[].<const E>>(): string { return "dyn " + String(E); } '
  + 'function f<[const N].<const E>>(): string { return "fix " + String(N) + " " + String(E); } ';

test('a function case matches by form: a dynamic array, or a fixed one with its extent captured', () => {
  expect(evaluated(`${F} f.<[].<uint8>>() + " | " + f.<[4].<uint16>>() + " | " + f.<string>();`))
    .toBe('dyn uint.<8> | fix 4 uint.<16> | p');
});

test('a literal extent matches only that extent', () => {
  // This crashed the host: the extent `4` was never resolved, and a fixed
  // extent is a VALUE, compared as a number.
  expect(evaluated('function f<T: type>(): string { return "p"; } function f<[4].<const E>>(): string { return "four " + String(E); } '
    + 'f.<[4].<uint8>>() + "," + f.<[5].<uint8>>();')).toBe('four uint.<8>,p');
});

test('specificity: a fixed element over a captured one over a bare capture; equal cases are ambiguous', () => {
  expect(evaluated('function f<T: type>(): string { return "any"; } function f<[].<const E>>(): string { return "arr"; } '
    + 'function f<[].<uint8>>(): string { return "u8arr"; } f.<[].<uint8>>() + "," + f.<[].<uint16>>() + "," + f.<string>();'))
    .toBe('u8arr,arr,any');
  expectThrown('function f<T: type>(): string { return "p"; } function f<[].<const E>>(): string { return "a"; } '
    + 'function f<[].<const F>>(): string { return "b"; } f.<[].<uint8>>();', 'neither is more specific than the other');
});

test('array and tuple patterns nest, and a nested capture\'s bound is enforced', () => {
  expect(evaluated('function f<T: type>(): string { return "p"; } function f<[[].<const E>, string]>(): string { return "nested " + String(E); } '
    + 'f.<[[].<uint8>, string]>() + "," + f.<[[].<uint8>, uint8]>();')).toBe('nested uint.<8>,p');
  // A tuple pattern with a fixed element crashed the host the same way.
  expect(evaluated('function f<T: type>(): string { return "p"; } function f<[const E, string]>(): string { return "tuple " + String(E); } '
    + 'f.<[uint8, string]>() + "," + f.<[uint8, uint8]>();')).toBe('tuple uint.<8>,p');
  expect(evaluated('function f<T: type>(): string { return "p"; } function f<[].<const E: type extends uint8 | uint16>>(): string { return "bounded"; } '
    + 'f.<[].<uint8>>() + "," + f.<[].<string>>();')).toBe('bounded,p');
});

test('a class case over an array runs its body and has its layout', () => {
  expect(evaluated('class C<T: type> { k(): string { return "p"; } } class C<[].<const E>> { k(): string { return "dyn"; } } '
    + 'new C.<[].<uint8>>().k() + "," + new C.<[4].<uint8>>().k();')).toBe('dyn,p');
  expect(evaluated('class Cell<T: type> { a: uint8; } class Cell<[const N].<const E>> { a: uint8; b: uint32; } '
    + 'class H { g: Cell.<[4].<uint8>> = new Cell.<[4].<uint8>>(); } class K { g: Cell.<string> = new Cell.<string>(); } '
    + 'String(H.byteLength) + "," + String(K.byteLength);')).toBe('8,1');
});

test('an alias case over an array: selected at run time and by the checker, deferred while open', () => {
  const A = 'type Elem<T: type> = T; type Elem<[].<const E>> = E; ';
  expect(evaluated(`${A} String(Elem.<[].<uint8>>) + "," + String(Elem.<string>);`)).toBe('uint.<8>,string');
  expect(evaluated(`${A} let x: Elem.<[].<uint8>> = (1 := uint8); String(x);`)).toBe('1');
  expectThrown(`${A} let x: Elem.<[].<uint8>> = 'no';`, 'is not assignable to "uint.<8>"');
  expect(evaluated(`${A} function f<T: type>(v: Elem.<[].<T>>): Elem.<[].<T>> { return v; } String(f.<uint8>((3 := uint8)));`)).toBe('3');
  expectThrown(`${A} function g<T: type>(v: T): Elem.<[].<T>> { return v; }`, '"T" is not assignable to "Elem.<[].<T>>"');
});

test('an open extent defers: the case is chosen once the extent is known, and not assumed before', () => {
  const X = 'type Ex<T: type> = T; type Ex<[4].<const E>> = E; ';
  expect(evaluated(`${X} function f<N: uint32>(v: Ex.<[N].<uint8>>): Ex.<[N].<uint8>> { return v; } String(f.<4>((1 := uint8)));`)).toBe('1');
  expectThrown(`${X} function g<N: uint32>(v: uint8): Ex.<[N].<uint8>> { return v; }`, 'is not assignable to "Ex.<[N: uint.<32>].<uint.<8>>>"');
});

test('an interface case over an array refines the contract of the application that selects it', () => {
  const I = 'interface Store<T: type> { get(): T; } interface Store<[].<const E>> { get(): [].<E>; first(): E; } ';
  expectThrown(`${I} function g(s: Store.<[].<uint8>>): string { return s.first(); }`, '"uint.<8>" is not assignable to "string"');
  expectThrown(`${I} class P implements Store.<[].<uint8>> { get(): [].<uint8> { return []; } }`, 'declares no member first');
});

test('an array whose extent is a value parameter is the same type as itself, and not as another', () => {
  // Extents were compared with `===`, so two mentions of `N` - two records of
  // one type - were different, and this identity refused its own parameter.
  expect(evaluated('function f<N: uint32>(v: [N].<uint8>): [N].<uint8> { return v; } "ok";')).toBe('ok');
  expectThrown('function f<N: uint32, M: uint32>(v: [N].<uint8>): [M].<uint8> { return v; }', 'is not assignable to "[M: uint.<32>].<uint.<8>>"');
});
