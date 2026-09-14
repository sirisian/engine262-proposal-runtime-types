import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'for (x + 300; false;) {}', 'for (; false; x + 300) {}',
  'throw x + 300;', 'return `${x + 300}`;', '[...x];', 'throw [...x];',
])('discarding or embedding an expression retains its checks: %s', (body) => {
  expectStaticTypeError(`function unused(x: uint8) { ${body} }`);
});

test('discarded traversal preserves nested function scope and contextual literals', () => {
  expect(ok('function f(x: uint8) { throw async function(x: uint16) { return x + 300; }; }')).toBe(true);
  expect(evaluated('function f(x: uint64) { for (x + 9007199254740993; false;) {} return `${x + 9007199254740993}`; } f(1);')).toBe('9007199254740994');
  expect(ok('function f(x: uint8 | string) { throw typeof x === "string" ? x.length : x + 1; }')).toBe(true);
});

test.each([
  ['decimal128', '~x'], ['decimal128', 'x & x'], ['decimal64', 'x << x'],
  ['rational.<64>', 'x % x'], ['rational.<64>', 'x << x'],
  ['complex128', 'x % x'], ['complex128', 'x < x'], ['complex128', '~x'],
])('%s has no operation %s', (type, expression) => {
  expectStaticTypeError(`function unused(x: ${type}) { ${expression}; }`);
  expectStaticTypeError(`function unused(x: ${type}) { throw ${expression}; }`);
});

test.each(['*', '+', '<<', '<'])(
  'known Number and sized numeric operands cannot mix at %s', (operator) => {
    expectStaticTypeError(`function unused(x: uint8, y: number) { x ${operator} y; }`);
    expectStaticTypeError(`function unused(x: float32, y: number) { return x ${operator} y; }`);
  },
);

test('numeric eligibility retains legacy, dynamic, rational, and declared operations', () => {
  expect(evaluated('function f(x: number): number { return ~x; } String(f(1));')).toBe('-2');
  expect(ok('function f(x: uint8, y: any) { x * y; x == y; }')).toBe(true);
  expect(ok('function f(x: rational.<64>, n: int32) { x ** n; }')).toBe(true);
  expect(ok('class C { operator%(other: C): boolean { return true; } } function f(x: C) { x % x; }')).toBe(true);
});

test.each(['"bad"', '-1', '1.5'])(
  'typed length rejects an invalid literal %s before evaluation', (value) => {
    expectStaticTypeError(`function unused(a: [].<uint8>) { a.length = ${value}; }`);
    expectStaticTypeError(`function unused(a: [].<uint8>) { a["length"] = ${value}; }`);
  },
);

test('typed length checks fixed extents, count types, and runtime dynamic values', () => {
  expectStaticTypeError('function unused(a: [2].<uint8>) { a.length = 3; }');
  expectStaticTypeError('function unused(a: [].<uint8>, n: number) { a.length = n; }');
  expect(evaluated('let a: [].<uint8> = [1, 2]; a.length = 1; String(a.length);')).toBe('1');
  expect(evaluated('let a: [2].<uint8> = [1, 2]; a.length = 2; String(a.length);')).toBe('2');
  expectThrownKind('let a: [].<uint8> = [1, 2]; let n: any = "bad"; a.length = n;', 'TypeError');
  expectThrownKind('let a: [].<uint8> = [1, 2]; let n: any = -1; a.length = n;', 'RangeError');
  expect(evaluated('let a = [1, 2]; a.length = "1"; String(a.length);')).toBe('1');
});

test('a valid count does not remove reference liveness checks', () => {
  expectThrownKind('let a: [].<uint8> = [1, 2]; for (const ref p of a) { a.length = 1; }', 'TypeError');
  expectThrownKind('let a: [].<uint8> = [1, 2]; let ref p = a[1]; a.length = 1; String(p);', 'TypeError');
});

test.each([
  'let ref p = n.x;', 'let o = {}; let ref p = o.x; ref p = n.x;',
  'function g(ref p) {} g(ref n.x);', 'return ref n.x;',
])('primitive borrow rejection reaches each entry point: %s', (body) => {
  expectStaticTypeError(`function unused(n: uint8) { ${body} }`);
});

test('private, super, bit-field, and nonlocation borrows reject early', () => {
  expectStaticTypeError('class C { #x = 1; f() { let ref p = this.#x; } }');
  expectStaticTypeError('class B { x = 1; } class C extends B { f() { let ref p = super.x; } }');
  expectStaticTypeError('class C { x: uint.<4>; } function unused(c: C) { let ref p = c.x; }');
  expectStaticTypeError('function unused() { let ref p = (1); }');
  expect(ok('class C { #x: uint8 = 1; f() { this.#x++; } }')).toBe(true);
});

test('dynamic properties, accessors, and local ref returns remain valid', () => {
  expect(ok('function f(o) { let ref p = o.x; }')).toBe(true);
  expect(evaluated('let n = 1; let o = { get x() { return n; }, set x(v) { n = v; } }; let ref p = o.x; p = 2; String(n);')).toBe('2');
  expect(evaluated('function f(): ref uint8 { let n: uint8 = 1; return ref n; } String(f());')).toBe('1');
});

test.each(['string', 'Set.<uint8>', 'Generator.<uint8, void, void>'])(
  'ref iteration rejects known nonstorage iterable %s', (type) => {
    expectStaticTypeError(`function unused(a: ${type}) { for (const ref p of a) {} }`);
    expect(ok(`function unused(a: ${type}) { for (const p of a) {} }`)).toBe(true);
  },
);

test('ref iteration accepts arrays and defers unknown storage', () => {
  expect(ok('type A = [].<uint8>; function f(a: A) { for (let ref p of a) { p = 1; } }')).toBe(true);
  expect(ok('function f(a) { for (const ref p of a) {} }')).toBe(true);
});
