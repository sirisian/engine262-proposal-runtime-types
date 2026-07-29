import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * typeprogramming.md §6.6, "Symbol literal types - adopt them", first step.
 *
 * §6.6: "a declared `const s = Symbol()` used in type position IS the unique
 * symbol type, without a keyword" - identity-compared like every other literal.
 * A checker has no VALUES, so that identity is carried by the DECLARATION: two
 * consts are two types, and one const named twice is one type.
 *
 * THIS STEP MAKES THE RULE TOTAL rather than making it judge. A computed member
 * name whose expression has no literal type cannot be compared by any static
 * rule, so it is REFUSED - TypeScript's rule ("must refer to an expression whose
 * type is a literal type or a 'unique symbol' type") and this project's
 * standing instinct: a member that is declared and unjudgeable reads as support.
 * What survives the refusal is exactly what §6.6 can type.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('a computed key that CAN be typed is accepted', () => {
  // The `const` symbol §6.6 names.
  expect(outcome('const k = Symbol("k"); interface I { [k]: string; }')).toBe('ACCEPTED');
  expect(outcome('const k = Symbol(); interface I { [k]: string; }')).toBe('ACCEPTED');
  // A written literal is a literal type as much as a const symbol is - `["s"]`
  // and `[1]` are the same members as `s` and `1`, spelled through brackets.
  expect(outcome('interface I { ["s"]: string; }')).toBe('ACCEPTED');
  expect(outcome('interface I { [1]: string; }')).toBe('ACCEPTED');
  // And an ordinary name is untouched by any of this.
  expect(outcome('interface I { s: string; }')).toBe('ACCEPTED');
});

test('a computed key that CANNOT be typed is refused', () => {
  // A `let` may be reassigned, so the binding names no fixed symbol.
  expect(outcome('let k = Symbol("k"); interface I { [k]: string; }')).toBe('TypeError');
  // A parameter has no identity at all until the function runs.
  expect(outcome('function f(p) { interface I { [p]: string; } } f(1);')).toBe('TypeError');
  // An arbitrary expression has type `number`, not a literal type - TypeScript
  // refuses this one too.
  expect(outcome('interface I { [1 + 1]: string; }')).toBe('TypeError');
  // A const that is NOT a symbol: the rule is about what can be compared, and a
  // const bound to a call that is not `Symbol` has no literal type either.
  expect(outcome('const k = String("k"); interface I { [k]: string; }')).toBe('TypeError');
});

test('the rule reaches a `partial interface`, which is where metadata lives', () => {
  // decorators.md adds metadata through `partial interface ClassMetadata {
  // [myMetadata]: string }`, so the partial form is the one that matters most.
  expect(outcome('const k = Symbol("k"); partial interface ClassFieldMetadata { [k]: string; }')).toBe('ACCEPTED');
  expect(outcome('let k = Symbol("k"); partial interface ClassFieldMetadata { [k]: string; }')).toBe('TypeError');
});

test('an interface NOTHING REFERENCES is judged, which needed forcing', () => {
  // The interface member walk is lazy for the same reason the class one was, so
  // a rule checked there fires only if something demands the interface's type.
  // Forced once per interface, as the class walk is - without it this rule
  // would hold only for interfaces that happen to be used.
  expect(outcome('let k = Symbol("k"); interface Unused { [k]: string; } 1;')).toBe('TypeError');
});

test('PINNED: recognition is not yet JUDGEMENT', () => {
  // What this step does NOT do. A symbol-keyed member is accepted and still not
  // type-checked at a store or at construction - §6.6's remaining work is to
  // carry the symbol literal type into the checker's property list, which is
  // keyed by string today. The refusal above is what makes that work total when
  // it lands: every member that survives is one the type can be produced for.
  const decl = 'const k = Symbol("k"); interface I { [k]: string; } ';
  expect(outcome(`${decl} let m: I = { [k]: 5 };`)).toBe('ACCEPTED');
  expect(outcome(`${decl} let m: I = { [k]: "ok" }; m[k] = 5;`)).toBe('ACCEPTED');
  // The string-keyed control, which IS judged - the difference is still the key.
  expect(outcome('interface J { s: string; } let m: J = { s: 5 };')).toBe('TypeError');
});
