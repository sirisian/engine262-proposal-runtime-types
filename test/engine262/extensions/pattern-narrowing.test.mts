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
  // An UNANNOTATED binding still types loosely: it is left undeclared rather
  // than declared as `any`, so it resolves outward the way any free name does.
  // Typing it as the SUBJECT's narrowed type is the remaining work - and
  // declaring `any` here would have looked exactly like that work was done.
  expect(outcome('function f(v: uint8) { return match (v) { when let x: (() => { const s: string = x; return s; })(); default: ""; }; } f(uint8(1));')).toBe('ACCEPTED');
  // LITERAL PROPAGATION into patterns: `when 27:` against a `uint8` subject
  // should be a `uint8` 27, and a literal that cannot take the position type a
  // compile-time TypeError.
  expect(outcome('function f(v: uint8) { return match (v) { when 300: 1; default: 0; }; } f(uint8(1));')).toBe('ACCEPTED');
});


test('an ANNOTATED binding types as its annotation', () => {
  // The narrowing a pattern can always justify: `let x: uint8` makes `x` a
  // `uint8` in the arm, and a clause is its own scope - "a fresh declarative
  // environment per clause" at run time, a frame in the checker.
  const outcome2 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome2('function f(v: uint8) { return match (v) { when let x: uint8: x; default: uint8(0); }; } f(uint8(1));')).toBe('ACCEPTED');
  // THE DISCRIMINATING ASSERTION: assigning the bound name to an unrelated type
  // is REFUSED, which is what says the annotation reached the arm rather than
  // the name staying `any`.
  expect(outcome2('function f(v: uint8) { return match (v) { when let x: uint8: (() => { const s: string = x; return s; })(); default: ""; }; } f(uint8(1));')).toBe('TypeError');
  // And the runtime is unchanged by the checker knowing more.
  expect(evaluated('String(match (5) { when let x: x * 2; default: 0; });')).toBe('10');
});

test('PINNED: the binding colon is ambiguous in a MEMBER position too', () => {
  // `{ a: let n: uint8 }` needs the same second-colon rule a clause has, and a
  // member position has no clause colon to speculate on - the same
  // context-dependence pattern-bindings.test.mts pins for `is`.
  const outcome3 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome3('function f(v: { a: uint8 }) { return match (v) { when { a: let n: uint8 }: n; default: uint8(0); }; } f({ a: uint8(1) });')).toBe('SyntaxError');
  // The UNANNOTATED member binding works.
  expect(evaluated('String(match ({ a: 7 }) { when { a: let n }: n; default: 0; });')).toBe('7');
});
