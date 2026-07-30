import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-pattern-matching.md phase five, NARROWING.
 *
 * `sec-match-narrowing`. What a pattern establishes about its subject is what
 * the arm may rely on - and what it CANNOT establish is as much of the design as
 * what it can: "`not` and arm-failure narrow only what subtraction can
 * represent - union members, sealed subclasses, literals, `null`".
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('a bare TYPE pattern narrows, as it always did', () => {
  expect(outcome('function f(v: uint8 | string) { if (v is uint8) { const n: uint8 = v; return n; } return uint8(0); } f(uint8(1));')).toBe('ACCEPTED');
  // The discriminating half: the OTHER member is refused in that branch, which
  // says the narrowing happened rather than the check being skipped.
  expect(outcome('function f(v: uint8 | string) { if (v is uint8) { const s: string = v; return s; } return ""; } f(uint8(1));')).toBe('TypeError');
});

test('`not` NEGATES the narrowing rather than abandoning it', () => {
  // "`v is not uint8` leaves `v` everything it was except `uint8`" - which is
  // union subtraction, the one operation this design's narrowing can perform.
  expect(outcome('function f(v: uint8 | string) { if (v is not uint8) { const s: string = v; return s; } return ""; } f("a");')).toBe('ACCEPTED');
  // And the subtracted member is REFUSED there, which is what distinguishes a
  // real negation from simply giving up and leaving the union.
  expect(outcome('function f(v: uint8 | string) { if (v is not uint8) { const n: uint8 = v; return n; } return uint8(0); } f("a");')).toBe('TypeError');
  // `not not T` is `T`, so the negations compose rather than the first one
  // winning.
  expect(outcome('function f(v: uint8 | string) { if (v is not not uint8) { const n: uint8 = v; return n; } return uint8(0); } f(uint8(1));')).toBe('ACCEPTED');
});

test('PINNED: what narrowing does NOT do, by the design\'s own account', () => {
  // "A failed structural pattern narrows nothing", because negation types do
  // not exist here - so a `not` over an object pattern establishes nothing in
  // the true branch and the union survives intact.
  // The union SURVIVES INTACT, so NEITHER member can be assigned in that
  // branch - which is what "narrows nothing" looks like from the inside, and is
  // the opposite of what a permissive implementation would produce.
  expect(outcome('function f(v: uint8 | string) { if (v is not { x: _ }) { const n: uint8 = v; return n; } return uint8(0); } f(uint8(1));')).toBe('TypeError');
  expect(outcome('function f(v: uint8 | string) { if (v is not { x: _ }) { const s: string = v; return s; } return ""; } f("a");')).toBe('TypeError');
  // A BOUND NAME types loosely - `x` here is `any`, which is why assigning it
  // to an unrelated type succeeds. Typing a binding as what the pattern
  // established is the remaining narrowing work.
  expect(outcome('function f(v: uint8) { return match (v) { when let x: (() => { const s: string = x; return s; })(); default: ""; }; } f(uint8(1));')).toBe('ACCEPTED');
  // LITERAL PROPAGATION into patterns: `when 27:` against a `uint8` subject
  // should be a `uint8` 27, and a literal that cannot take the position type a
  // compile-time TypeError.
  expect(outcome('function f(v: uint8) { return match (v) { when 300: 1; default: 0; }; } f(uint8(1));')).toBe('ACCEPTED');
});
