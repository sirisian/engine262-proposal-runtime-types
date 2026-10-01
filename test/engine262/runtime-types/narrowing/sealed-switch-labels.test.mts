import { test, expect } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

// #sec-sealed-classes with #table-narrowing-forms: each label of a sealed `switch`
// sees the discriminant less what the labels before it took, so an unrelated,
// repeated or dominated label can never succeed (#sec-narrowfrom).

test.each([
  "sealed abstract class S {} class A extends S {} class AA extends A {} class B extends S {} class C {} function f(s: S) { switch (s) { case C: return 1; case A: return 2; case B: return 3; } }",
  "sealed abstract class S {} class A extends S {} class AA extends A {} class B extends S {} class C {} function f(s: S) { switch (s) { case A: return 1; case B: return 2; case A: return 3; } }",
  "sealed abstract class S {} class A extends S {} class AA extends A {} class B extends S {} class C {} function f(s: S) { switch (s) { case A: return 1; case AA: return 2; case B: return 3; } }",
])("a sealed label left nothing is refused: %s", expectStaticTypeError);

test.each([
  "sealed abstract class S {} class A extends S {} class AA extends A {} class B extends S {} class C {} function f(s: S) { switch (s) { case AA: return 1; case A: return 2; case B: return 3; } } 'ok';",
])("a sealed label with something left is accepted: %s", (source) => expect(ok(source)).toBe(true));
