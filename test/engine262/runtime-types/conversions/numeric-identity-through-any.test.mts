import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

// #sec-requiretype: any defers a check; it does not erase a sized numeric type.
test.each(['1', '300'])('a uint16 value %s does not implicitly narrow through any', (value) => {
  const source = `function g():any { return (${value} := uint16); }`;
  for (const boundary of [
    'let n:uint8 = g();',
    'function f(n:uint8) {} f(g());',
    'function f():uint8 { return g(); } f();',
  ]) {
    expectThrownKind(`${source} ${boundary}`, 'TypeError');
  }
});

test('sized numeric widening also requires an explicit conversion through any', () => {
  expectThrownKind('function g():any { return (1 := uint8); } let n:uint16 = g();', 'TypeError');
});

test.each(['1', '1n'])('an untyped numeric value %s still crosses the checked boundary', (value) => {
  expect(evaluated(`function g():any { return ${value}; } const n:uint8 = g(); String(n);`)).toBe('1');
});

test.each(['300', '300n', '1.5', 'NaN', 'Infinity'])('an unrepresentable untyped numeric value %s remains a range error', (value) => {
  expectThrownKind(`function g():any { return ${value}; } let n:uint8 = g();`, 'RangeError');
});

test('matching and union targets retain the sized value type', () => {
  expect(evaluated('function g():any { return (1 := uint16); } const n:uint16 = g(); String(Reflect.typeOf(n));')).toBe('uint.<16>');
  expect(evaluated('function g():any { return (1 := uint16); } const n:uint8|uint16 = g(); String(Reflect.typeOf(n));')).toBe('uint.<16>');
});

test('an explicit conversion remains the instruction to change numeric type', () => {
  expect(evaluated('function g():any { return (300 := uint16); } const n:uint8 = g() := uint8; String(n);')).toBe('44');
});
