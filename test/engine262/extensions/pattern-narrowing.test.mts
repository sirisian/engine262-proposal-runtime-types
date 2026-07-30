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
  // SEALED-CLASS exhaustiveness, which the clause names beside enums and which
  // must be BUILT rather than extended - the checker tracks no `sealed`
  // machinery at all.
  expect(outcome('class S {} class T extends S {} function f(s: S) { return match (s) { when T: 1; }; } f(new T());')).toBe('ACCEPTED');
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

test('a MEMBER binding may be annotated too', () => {
  // The third position the colon rule reaches, settled by the same context flag
  // - a member position has no clause colon, so `let n: uint8` is complete.
  const outcome3 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome3('function f(v: { a: uint8 }) { return match (v) { when { a: let n: uint8 }: n; default: uint8(0); }; } f({ a: uint8(1) });')).toBe('ACCEPTED');
  expect(evaluated('String(match ({ a: uint8(1) }) { when { a: let n: uint8 }: 1; default: 0; });')).toBe('1');
  // The annotation TESTS, so a member of the wrong type falls through.
  expect(evaluated('String(match ({ a: 1 }) { when { a: let n: uint8 }: 1; default: 0; });')).toBe('0');
  expect(evaluated('String(match ({ a: 7 }) { when { a: let n }: n; default: 0; });')).toBe('7');
});


test('an UNANNOTATED binding types as the SUBJECT', () => {
  // "A binding always matches", so it establishes nothing about the value
  // beyond what the position already said - which makes the subject's type
  // exactly right for a top-level binding.
  const outcome4 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome4('function f(v: uint8) { return match (v) { when let x: x; default: uint8(0); }; } f(uint8(1));')).toBe('ACCEPTED');
  // THE DISCRIMINATING ASSERTION: assigning it to an unrelated type is REFUSED,
  // where before it was accepted because the name was undeclared and resolved
  // outward as a free name.
  expect(outcome4('function f(v: uint8) { return match (v) { when let x: (() => { const s: string = x; return s; })(); default: ""; }; } f(uint8(1));')).toBe('TypeError');
  // The runtime is unchanged by the checker knowing more.
  expect(evaluated('String(match (5) { when let x: x * 2; default: 0; });')).toBe('10');
  // A COMBINATOR does not change the position, so both sides see the same type.
  expect(outcome4('function f(v: uint8) { return match (v) { when let x and uint8: x; default: uint8(0); }; } f(uint8(1));')).toBe('ACCEPTED');
});


test('a binding in a STRUCTURAL position types from its slot', () => {
  // The subject's type is WALKED ALONGSIDE the pattern: a member's sub-pattern
  // sees the type of the property it names, and a tuple element sees its
  // position's. Passing the whole subject type down would have typed a member
  // binding as the OBJECT - worse than leaving it loose, because it would be
  // confidently wrong.
  const outcome5 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome5('function f(v: { a: uint8 }) { return match (v) { when { a: let n }: n; default: uint8(0); }; } f({ a: uint8(1) });')).toBe('ACCEPTED');
  expect(outcome5('function f(v: { a: uint8 }) { return match (v) { when { a: let n }: (() => { const s: string = n; return s; })(); default: ""; }; } f({ a: uint8(1) });')).toBe('TypeError');
  // A TUPLE subject types each element BY POSITION, so the second element's
  // type is not the first's.
  expect(outcome5('function f(v: [uint8, string]) { return match (v) { when [let a, let b]: a; default: uint8(0); }; } f([uint8(1), "s"]);')).toBe('ACCEPTED');
  expect(outcome5('function f(v: [uint8, string]) { return match (v) { when [let a, let b]: (() => { const s: string = a; return s; })(); default: ""; }; } f([uint8(1), "s"]);')).toBe('TypeError');
  // The runtime is unchanged throughout.
  expect(evaluated('String(match ({ a: 7 }) { when { a: let n }: n; default: 0; });')).toBe('7');
  expect(evaluated('String(match ([1, 9]) { when [1, let b]: b; default: 0; });')).toBe('9');
});


test('a numeric literal takes the CONTEXTUAL TYPE of its position', () => {
  // "`when 27:` against a `uint8` field is a `uint8` 27", and a literal that
  // CANNOT take the position type is a compile-time TypeError - the same
  // impossible-test rule the checker enforces for a comparison.
  const outcome6 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome6('function f(v: uint8) { return match (v) { when 27: 1; default: 0; }; } f(uint8(1));')).toBe('ACCEPTED');
  expect(outcome6('function f(v: uint8) { return match (v) { when 300: 1; default: 0; }; } f(uint8(1));')).toBe('TypeError');
  // A NEGATIVE literal is a unary minus over a NumericLiteral rather than a
  // NumericLiteral, so reading only the literal node let this through - and an
  // unsigned type has no negative values at all, which is the case the rule
  // most exists for.
  expect(outcome6('function f(v: uint8) { return match (v) { when -1: 1; default: 0; }; } f(uint8(1));')).toBe('TypeError');
  expect(outcome6('function f(v: int8) { return match (v) { when -128: 1; default: 0; }; } f(int8(1));')).toBe('ACCEPTED');
  // A plain `number` position takes any numeric literal.
  expect(outcome6('function f(v: number) { return match (v) { when 300: 1; default: 0; }; } f(1);')).toBe('ACCEPTED');
});

test('a numeric literal against a UNION of numeric types is ambiguous', () => {
  // "Matching only one would be a silent half-answer" - and there is no
  // principled way to pick a member, so this needs a RULE rather than
  // inference. It is the one case the design calls out by name.
  const outcome7 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome7('function f(v: uint8 | float32) { return match (v) { when 5: 1; default: 0; }; } f(uint8(5));')).toBe('TypeError');
  // A union with only ONE numeric member is not ambiguous.
  expect(outcome7('function f(v: uint8 | string) { return match (v) { when 5: 1; default: 0; }; } f(uint8(5));')).toBe('ACCEPTED');
  // The runtime is unchanged.
  expect(evaluated('String(match (5) { when 5: "five"; default: "other"; });')).toBe('five');
});
