import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([['bigint', '+'], ['symbol', '+'], ['symbol', '-'], ['symbol', '~']])(
  'typed %s operands do not admit unary %s', (type, operator) => {
    expectStaticTypeError(`function unused(x: ${type}) { ${operator}x; }`);
    expectStaticTypeError(`function unused(x: ${type}) { const y = x; ${operator}((y)); }`);
  },
);

test('an impossible BigInt result is not published', () => {
  expectStaticTypeError('function unused(x: bigint) { const result: bigint = +x; }');
});

test('typed members and return contracts contribute to the judgment', () => {
  expectStaticTypeError('function unused(o: { x: symbol }) { -o.x; }');
  expectStaticTypeError('function unused(o: { x: symbol }) { const { x } = o; -x; }');
  expectStaticTypeError('function unused(a: [].<symbol>) { for (const x of a) { -x; } }');
  expectStaticTypeError('class C { x: bigint = 1n; unused() { +this.x; } }');
  expectStaticTypeError('function f(): bigint { return 1n; } function unused() { +f(); }');
  expectStaticTypeError('type B = bigint; function unused(x: B) { +x; }');
});

test('only all-forbidden unions establish failure', () => {
  expectStaticTypeError('function unused(x: bigint | symbol) { +x; }');
  expect(ok('function f(x: bigint | number) { return +x; } f(1);')).toBe(true);
  expect(ok('function unused(x: symbol | bigint) { -x; ~x; }')).toBe(true);
});

test('BigInt negation, bitwise NOT and proposal numeric families remain valid', () => {
  expect(evaluated('function f(x: bigint) { return String(-x) + "," + String(~x); } f(2n);')).toBe('-2,-3');
  expect(evaluated('function f(x: uint64) { return +x; } String(f(uint64(2)));')).toBe('2');
  expect(evaluated('let d: decimal64 = 1.00; String(+d);')).toBe('1.00');
  expect(evaluated('let r: rational = 1 / 3; String(+r);')).toBe('1/3');
});

test('overloads and ordinary primitive coercions retain their domains', () => {
  expect(evaluated('class P { operator+(): bigint { return 1n; } } String(+new P());')).toBe('1');
  expect(evaluated('String(+"3") + "," + String(+true) + "," + String(+null) + "," + String(+undefined);')).toBe('3,1,0,NaN');
});

test.each([
  '+1n;', '+Symbol();', '-Symbol();', '~Symbol();',
  'const n = 1n; +n;', 'const s = Symbol(); -s;',
  'function f(unrelated: uint8) { +1n; } f(1);',
  'function f(x: any) { +x; } f(1n);',
  'let x = 1n; +x;',
  '+BigInt(1);', 'const x = BigInt(1); +x;', '-Symbol.iterator;',
  'for (const s of [Symbol()]) { -s; }', 'const [s] = [Symbol()]; -s;',
  'const { s } = { s: Symbol() }; -s;', 'const [...s] = [Symbol()]; -s[0];',
  'function f(x: boolean) { +(x ? 1n : 2n); } f(true);',
  'function f(x: uint8) { +(x, 1n); } f(1);',
])('legacy or unknown operands retain runtime error timing: %s', (source) => {
  expectThrownKind(source, 'TypeError');
});

test('an untyped binding and shadowing do not inherit another operand contract', () => {
  expect(ok('function unused(x: bigint) { { let x; +x; } }')).toBe(true);
  expect(ok('function unused(x: bigint) { let y = x; +y; }')).toBe(true);
  expect(ok('function f(x: any) { return +x; } f("3");')).toBe(true);
});
