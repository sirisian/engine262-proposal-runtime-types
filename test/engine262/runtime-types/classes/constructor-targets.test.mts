import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each(['super("bad")', 'super()'])('known base signatures check %s before invocation', (call) => {
  expectStaticTypeError(`class B { constructor(x: uint8) {} } class D extends B { constructor() { ${call}; } }`);
});

test('implicit derived constructors forward the base contract', () => {
  expectStaticTypeError('class B { constructor(x: uint8) {} } class D extends B {} function f() { new D("bad"); }');
  expectStaticTypeError('class B { constructor(x: uint8) {} } class D extends B {} function f() { new D(); }');
  expect(evaluated('class B { x: uint8; constructor(x: uint8) { this.x = x; } } class D extends B {} String(new D(1).x);')).toBe('1');
});

test.each(['new (A)()', 'new A.<uint8>()', 'new (A.<uint8>)()'])(
  'abstractness survives wrapping and specialization: %s', (expression) => {
    expectStaticTypeError(`abstract class A<T = uint8> {} function f() { ${expression}; }`);
  },
);

test('specialized constructor arguments and type arity survive parentheses', () => {
  expectStaticTypeError('class Box<T> { constructor(x: T) {} } function f() { new (Box.<uint8>)("bad"); }');
  expectStaticTypeError('class Box<T> {} function f() { new (Box.<uint8, string>)(); }');
  expect(ok('class Box<T> { constructor(x: T) {} } new (Box.<uint8>)(1);')).toBe(true);
});

test('base contracts preserve generic substitution, overloads, and unknown arguments', () => {
  expectStaticTypeError('class B<T> { constructor(x: T) {} } class D extends B.<uint8> { constructor() { super("bad"); } }');
  expectStaticTypeError('class B<T> { constructor(x: T) {} } class D extends B.<uint8> {} new D("bad");');
  expect(ok('class B { constructor(x: uint8) {} constructor(x: string) {} } class D extends B { constructor() { super("yes"); } } new D();')).toBe(true);
  expect(ok('class B { constructor(x: uint8) {} } class D extends B { constructor(x: any) { super(x); } } new D(uint8(1));')).toBe(true);
  expect(ok('abstract class B { constructor(x: uint8) {} } class D extends B { constructor() { super(1); } } new D();')).toBe(true);
});
