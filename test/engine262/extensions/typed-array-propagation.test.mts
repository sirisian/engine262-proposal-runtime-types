import { test, expect } from 'vitest';
import { evaluated, bool, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * Typed array propagation: a plain array literal in a `[].<T>` position takes the
 * element type.
 *
 * A plain array assigned to a `[].<T>` binding is converted element by element to
 * T at the binding boundary (README "Typed Array Propagation", spec
 * sec-contextual-types). Each element becomes a value of T, so `let a: [].<uint8>
 * = [1, 2, 3]` yields an array whose elements are uint8 values and whose stores
 * wrap like a Uint8Array. The conversion is the same checked conversion the scalar
 * boundary uses, so an out-of-range element is a TypeError, and it is recursive,
 * so a nested `[].<[].<T>>` propagates through. A fixed extent `[N].<T>` requires
 * the literal to have length N.
 */

// -- Element type propagation --------------------------------------------------
test('an array literal assigned to a dynamic typed array takes the element type', () => {
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; String(a.length);')).toBe('3');
  expect(bool('let a: [].<uint8> = [1, 2, 3]; String(a[0] instanceof uint8);')).toBe(true);
  expect(bool('let a: [].<uint8> = [1, 2, 3]; String(a[1] instanceof uint8);')).toBe(true);
});

test('the element type is reflected as the element type, not the plain number type', () => {
  expect(bool('let a: [].<uint16> = [1]; String(Reflect.typeOf(a[0]) === uint16);')).toBe(true);
});

// -- Stores wrap like the element type -----------------------------------------
test('an element store wraps like the element type', () => {
  // 255 is a uint8 element, so uint8 arithmetic wraps
  expect(evaluated('let a: [].<uint8> = [255]; String(a[0] + (1 := uint8));')).toBe('0');
  // a uint16 element wraps at its own width
  expect(evaluated('let a: [].<uint16> = [65535]; String(a[0] + (1 := uint16));')).toBe('0');
});

// -- Out-of-range element ------------------------------------------------------
test('an out-of-range element is a TypeError', () => {
  expectThrown('let a: [].<uint8> = [300];');
  expectThrown('let a: [].<uint8> = [1, 2, 300];');
});

// -- Fixed extent --------------------------------------------------------------
test('a fixed-extent typed array requires the literal length to match', () => {
  expect(evaluated('let a: [3].<uint8> = [1, 2, 3]; String(a.length);')).toBe('3');
  expectThrown('let a: [3].<uint8> = [1, 2];');
  expectThrown('let a: [2].<uint8> = [1, 2, 3];');
});

// -- Recursive propagation -----------------------------------------------------
test('propagation is recursive through nested typed arrays', () => {
  expect(evaluated('let a: [].<[].<uint8>> = [[1, 2], [3]]; String(a[0][1]);')).toBe('2');
  expect(bool('let a: [].<[].<uint8>> = [[5]]; String(a[0][0] instanceof uint8);')).toBe(true);
  // an out-of-range inner element is still caught
  expectThrown('let a: [].<[].<uint8>> = [[300]];');
});

// -- Other element types -------------------------------------------------------
test('a string element type propagates', () => {
  expect(evaluated('let a: [].<string> = ["x", "y"]; a[0];')).toBe('x');
});

test('an empty array literal is an empty typed array', () => {
  expect(evaluated('let a: [].<uint8> = []; String(a.length);')).toBe('0');
});

// -- Feature off ---------------------------------------------------------------
test('with the feature off, an array literal is an ordinary array', () => {
  // without the feature there is no `[].<T>` annotation to propagate; a plain array is itself
  const c = runFlagOff('let a = [1, 2, 3]; String(a.length);') as { Type: string, Value: { stringValue?(): string } };
  expect(c.Type).toBe('normal');
  expect(c.Value.stringValue?.()).toBe('3');
});
