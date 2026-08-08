import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * README: "A member marked `protected` is accessible within its declaring class
 * and its subclasses, and nowhere else."
 *
 * The rule is checked IN THE WALK rather than in `staticType`, which runs ON
 * DEMAND - a bare `b.a;` statement's type is never demanded, so a rule written
 * there fires only where something happens to ask. **A rule checked where
 * nothing asks is no rule at all**, which is the same shape the class member
 * walk was fixed for.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('an OUTSIDE read is refused', () => {
  // The README's own example: `// a.balance; // TypeError: balance is protected`.
  expect(outcome('class B { protected a: uint8 = 1; } const b: B = new B(); b.a;')).toBe('TypeError');
  expect(outcome('class B { protected a: uint8 = 1; } function f(x: B) { return x.a; }')).toBe('TypeError');
  // An UNRELATED class is outside too - being in *a* class is not being in
  // *the* class.
  expect(outcome('class B { protected a: uint8 = 1; } class Z { m(x: B) { return x.a; } }')).toBe('TypeError');
  // A PUBLIC member is unaffected, which says the rule reads the modifier
  // rather than refusing every typed member access.
  expect(outcome('class B { a: uint8 = 1; } const b: B = new B(); b.a;')).toBe('ACCEPTED');
});

test('INSIDE the class and its SUBCLASSES is allowed', () => {
  expect(outcome('class B { protected a: uint8 = 1; m() { return this.a; } }')).toBe('ACCEPTED');
  expect(outcome('class B { protected a: uint8 = 1; } class D extends B { m() { return this.a; } }')).toBe('ACCEPTED');
  // A grandchild too - the subclass half walks the whole heritage chain.
  expect(outcome('class B { protected a: uint8 = 1; } class D extends B {} class E extends D { m() { return this.a; } }')).toBe('ACCEPTED');
  // ANOTHER INSTANCE of the same class, read from inside it: "accessible
  // within its declaring class" is about WHERE THE CODE IS, not about which
  // object it reads.
  expect(outcome('class B { protected a: uint8 = 1; m(other: B) { return other.a; } }')).toBe('ACCEPTED');
});

test('it is DELIBERATELY NOT a runtime wall', () => {
  // "`protected` is an access rule checked where the STATIC TYPE IS KNOWN, and
  // it is deliberately not a runtime wall - a protected field occupies the
  // normal layout and stays reachable through reflection or an `any`-typed
  // reference, the erasure other languages apply to it."
  expect(outcome('class B { protected a: uint8 = 1; } const b: any = new B(); b.a;')).toBe('ACCEPTED');
  expect(evaluated('class B { protected a: uint8 = 1; } const b: any = new B(); String(b.a);')).toBe('1');
  // Reflection reports the modifier rather than hiding the member.
  expect(evaluated('class B { protected a: uint8 = 1; } '
    + 'String(Reflect.getReflection.<Reflect.ClassField, B>("a").protected);')).toBe('true');
});

test('PINNED: an UNANNOTATED binding has no static type to check against', () => {
  // `const b = new B(); b.a;` is ACCEPTED, because this checker records no type
  // for an inferred binding - and the rule is explicitly one "checked WHERE THE
  // STATIC TYPE IS KNOWN". So this is the design's own boundary rather than a
  // hole in the rule, and it closes when inference for `new` bindings lands.
  expect(outcome('class B { protected a: uint8 = 1; } const b = new B(); b.a;')).toBe('ACCEPTED');
  // The annotated form of the same program IS refused, which is what says the
  // gap is the binding's type and not the rule.
  expect(outcome('class B { protected a: uint8 = 1; } const b: B = new B(); b.a;')).toBe('TypeError');
});
