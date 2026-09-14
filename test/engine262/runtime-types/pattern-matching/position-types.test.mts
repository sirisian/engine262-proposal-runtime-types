import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

test.each([
  'function f(v: uint8) { if (v is let x: string) {} }',
  'function f(v: {a: uint8}) { if (v is {a: let x: string}) {} }',
  'function f(v: uint8 | string) { if (v is uint8 and let x: string) {} }',
  'function f(v: uint8) { match (v) { when let x: string: 1; default: 0; }; }',
])('impossible capture rejects before execution: %s', (source) => {
  expectEarlyError(source, 'StaticTypeError');
});

test('and carries the preceding type into captures and literals', () => {
  expect(evaluated('function f(v: uint8 | string) { if (v is uint8 and let x) { let n: uint8 = x; return n; } return 0; } String(f((1 := uint8)));')).toBe('1');
  expect(evaluated('function f(v: uint8 | uint16) { return v is uint8 and 1; } String(f((1 := uint8)));')).toBe('true');
  expectEarlyError('function f(v: uint8 | uint16) { return v is 1; }', 'StaticTypeError');
});

test('captures preserve overlapping positions and unknown inputs', () => {
  expect(evaluated('function f(v: uint8 | string) { if (v is let x: string) { return x; } return "no"; } f("yes");')).toBe('yes');
  expect(evaluated('function f(v: any) { if (v is let x: string) { return x; } return "no"; } f("yes");')).toBe('yes');
  expect(evaluated('let v: uint8 = 1; String(v is string);')).toBe('false');
});
