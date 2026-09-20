import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

test('inherited generic fields are read at the base specialization', () => {
  expect(evaluated('class Base<T> { x: T; } class Derived extends Base.<uint8> {} const d = new Derived(); let x: uint8 = d.x; String(x);')).toBe('0');
  expectStaticTypeError('class Base<T> { x: T; } class Derived extends Base.<uint8> {} function unused(d: Derived) { let x: string = d.x; }');
});

test('specialization passes through a generic subclass and reference argument', () => {
  expect(evaluated('class Base<T> { x: T; } class Middle<T> extends Base.<T> {} class Derived extends Middle.<uint8> {} function set(ref x: uint8) { x = 7; } const d = new Derived(); set(ref d.x); String(d.x);')).toBe('7');
});
