import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each(['-x', '+x', '~x', '!x', 'typeof x', 'void x', 'x++', '++x', 'x--', '--x'])(
  'the known result of %s is checked even in an unused function', (expression) => {
    expectStaticTypeError(`function f(x: uint8): [uint8] { return ${expression}; }`);
  },
);

test.each(['~x;', 'let y = ~x;', 'return ~x;'])(
  'binary-float bitwise-not is rejected independently of its use: %s', (body) => {
    expectStaticTypeError(`function f(x: float32) { ${body} }`);
  },
);

test.each(['<<=', '>>=', '>>>='])('compound %s checks literal distances', (operator) => {
  expectStaticTypeError(`function f(x: int8) { x ${operator} -1; }`);
  expectStaticTypeError(`function f(x: uint8) { x ${operator} 8; }`);
  expect(ok(`function f(x: uint8, distance: uint8) { x ${operator} distance; }`)).toBe(true);
});

test.each(['&=', '|=', '^=', '<<=', '>>=', '>>>='])('float32 has no %s operation', (operator) => {
  expectStaticTypeError(`function f(x: float32) { x ${operator} 1; }`);
});

test.each(['+=', '*='])('the result of %s is not its literal right operand', (operator) => {
  expectStaticTypeError(`function f(x: uint8): 1 { return x ${operator} 1; }`);
});

test('unary, update, and compound values retain their specified types and values', () => {
  expect(evaluated('function f(x: uint8): uint8 { return -x; } String(f(2));')).toBe('254');
  expect(evaluated('function f(x: uint8): uint8 { return x++; } String(f(2));')).toBe('2');
  expect(evaluated('function f(x: uint8): uint8 { return ++x; } String(f(2));')).toBe('3');
  expect(evaluated('function f(x: uint8): uint8 { return x += 1; } String(f(2));')).toBe('3');
  expect(evaluated('function f(x: uint8): void { return void x; } String(f(1));')).toBe('undefined');
});

test('declared unary and compound operators supply their own signatures', () => {
  expectStaticTypeError('class C { operator-(): uint8 { return 1; } } function f(c: C): [uint8] { return -c; }');
  expect(ok('class C { operator<<=(distance: uint8): boolean { return true; } } let c: C = new C(); c <<= 100;')).toBe(true);
});

test.each(['x++', '++x', 'x--', '--x'])('declared update %s checks both the result and the stored value', (expression) => {
  expectStaticTypeError(`class C { operator++(): C { return new C(); } operator--(): C { return new C(); } } function f(x: C): [uint8] { return ${expression}; }`);
  expectStaticTypeError(`class C { operator++(): boolean { return true; } operator--(): boolean { return false; } } function f(x: C) { ${expression}; }`);
  expect(ok(`class C { operator++(): C { return new C(); } operator--(): C { return new C(); } } function f(x: C): C { return ${expression}; }`)).toBe(true);
});
