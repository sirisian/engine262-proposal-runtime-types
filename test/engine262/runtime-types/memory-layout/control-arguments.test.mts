import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-layout-control.
 *
 * "Seven reserved names control the layout above. Each is a property-descriptor
 * key and each has a decorator of the same name that sets it."
 *
 * A control whose argument this engine cannot read is now REFUSED. It used to be
 * dropped, silently and completely: `const N = 2; @size(N) class A { x: float64
 * = 0; }` ran to completion and took its natural 8 bytes rather than the 2 it
 * asked for. The program did not get the layout it wrote, was not told, and the
 * overflow rule a `size` exists to enforce had nothing left to overflow.
 *
 * WHAT AN ARGUMENT MAY BE IS OPEN. The engine reads a literal only, and cited
 * #sec-memory-layout for "recognized syntactically and never evaluated" and
 * #sec-layout-properties for calling a control a compile-time constant. Neither
 * sentence is in the specification - #sec-layout-properties is about the
 * layout's `byteLength`, `bitLength` and `alignment` being compile-time
 * evaluable, not about a control's argument. So these tests pin the REFUSAL, not
 * the literal-only rule: if the rule is later widened to the
 * compile-time-evaluable fragment, which is what C++'s `alignas` and C's
 * `_Alignas` take, the cases below become accepted and this file changes with
 * it. Refusing first is what leaves that open; accepting first would not.
 */

test('a class control whose argument is not a literal is refused', () => {
  expectThrownKind('const N = 2; @size(N) class A { x: float64 = 0; }', 'TypeError');
  expectThrownKind('const N = 16; @size(N) class A { x: float64 = 0; }', 'TypeError');
  expectThrownKind('@size(8 * 2) class A { x: float64 = 0; }', 'TypeError');
  expectThrownKind('const A8 = 8; @alignAll(A8) class A { x: uint8 = 0; }', 'TypeError');
});

test('a field control whose argument is not a literal is refused', () => {
  expectThrownKind('const A4 = 4; class A { @align(A4) x: uint8 = 0; y: uint8 = 0; }', 'TypeError');
  expectThrownKind('const O = 4; class A { @offset(O) x: uint8 = 0; }', 'TypeError');
  expectThrownKind("const E = 'big'; class A { @endian(E) x: uint32 = 0; }", 'TypeError');
});

test('the refusal names the control', () => {
  expect(evaluated('try { eval("const N = 2; @size(N) class A { x: float64 = 0; }"); "no error"; } '
    + 'catch (e) { e.message; }')).toContain('@size');
  expect(evaluated('try { eval("const O = 4; class A { @offset(O) x: uint8 = 0; }"); "no error"; } '
    + 'catch (e) { e.message; }')).toContain('@offset');
});

test('a literal argument still sets the control', () => {
  expect(evaluated('@size(16) class A { x: float64 = 0; } String((type A).byteLength);')).toBe('16');
  expect(evaluated('@alignAll(8) class A { x: uint8 = 0; } String((type A).alignment);')).toBe('8');
  expect(evaluated('class A { @offset(4) x: uint8 = 0; } String((type A).byteLength);')).toBe('5');
});

test('a control with no argument is unaffected', () => {
  // `@packed` is a bare name, so there is no argument to read and nothing to
  // refuse.
  expect(evaluated('@packed class A { a: uint.<3> = 0; b: uint.<5> = 0; } String((type A).byteLength);')).toBe('1');
});

test('the size a literal fixes is still enforced', () => {
  // The rule the dropped control was disabling: "It is a type error for a field
  // to be placed outside the size a `size` fixes" (#sec-natural-alignment).
  expectThrownKind('@size(2) class A { x: float64 = 0; }', 'TypeError');
  // And it now fires for the named-constant spelling too, by refusing earlier -
  // where before, the control vanished and the class was silently accepted.
  expectThrownKind('const N = 2; @size(N) class A { x: float64 = 0; }', 'TypeError');
});
