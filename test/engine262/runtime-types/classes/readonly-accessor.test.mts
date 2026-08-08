import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-accessor.md section 2.5, settled: `readonly accessor` is LEGAL and means a
 * GETTER-ONLY accessor.
 *
 * The question asked whether it should be illegal or legal-but-unreportable.
 * Measured, it was neither: it PARSED AND DID NOTHING - assignment succeeded and
 * the context never mentioned it. **A modifier that parses and enforces nothing
 * is worse than one that is refused**, because the declaration reads as a
 * constraint and is not one.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('a readonly accessor installs a GETTER ONLY', () => {
  // Installing only the getter is what makes assignment fail, by the ordinary
  // rule for a getter-only property rather than by a check written for this.
  expect(evaluated('class A { readonly accessor a: uint8 = 3; } '
    + 'String(Object.getOwnPropertyDescriptor(A.prototype, "a").set);')).toBe('undefined');
  expect(evaluated('class A { readonly accessor a: uint8 = 3; } '
    + 'String(typeof Object.getOwnPropertyDescriptor(A.prototype, "a").get);')).toBe('function');
  // A NON-readonly accessor still has both, which says the change was narrowed
  // to the modifier rather than applied to every accessor.
  expect(evaluated('class A { accessor a: uint8 = 3; } '
    + 'String(typeof Object.getOwnPropertyDescriptor(A.prototype, "a").set);')).toBe('function');
});

test('assignment is refused, and the initializer still reaches the backing', () => {
  expect(outcome('"use strict"; class A { readonly accessor a: uint8 = 1; } const x = new A(); x.a = 2;')).toBe('TypeError');
  // Sloppy mode fails silently, as it does for any getter-only property - so
  // the VALUE is the assertion there, not the throw.
  expect(evaluated('class A { readonly accessor a: uint8 = 3; } const x = new A(); x.a = 9; String(x.a);')).toBe('3');
  // The INITIALIZER still works: DefineField writes the Private Name directly
  // and never goes through the setter, which is why removing the setter costs
  // nothing.
  expect(evaluated('class A { readonly accessor a: uint8 = 3; } String(new A().a);')).toBe('3');
  expect(evaluated('class A { readonly accessor a: uint8; } String(new A().a);')).toBe('0');
  // A non-readonly accessor is unaffected.
  expect(evaluated('class A { accessor a: uint8 = 1; } const x = new A(); x.a = 5; String(x.a);')).toBe('5');
});

test('the context REPORTS `readonly`', () => {
  expect(evaluated('let r; function f(c) { r = String(c.readonly); } '
    + 'class A { @f readonly accessor a: uint8 = 1; } r;')).toBe('true');
  expect(evaluated('let r; function f(c) { r = String(c.readonly); } '
    + 'class A { @f accessor a: uint8 = 1; } r;')).toBe('false');
});

test('the LAYOUT is unaffected by the modifier', () => {
  // "An accessor participates in the memory layout exactly as a field does" -
  // and a readonly one is still a field's worth of storage, so removing the
  // setter must not remove the slot.
  expect(evaluated('class A { readonly accessor a: uint32 = 1; } '
    + 'String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("a").byteLength);')).toBe('4');
  expect(evaluated('class A { x: uint32 = 0; readonly accessor a: uint8 = 1; } '
    + 'String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("a").offset);')).toBe('4');
});
