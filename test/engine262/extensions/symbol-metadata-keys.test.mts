import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators.md stage H, the METADATA half's blocker.
 *
 * decorators.md adds metadata through `partial interface ClassMetadata {
 * [myMetadata]: string }`, and a SYMBOL key is the collision escape hatch the
 * design gives third-party libraries. The member merged and then vanished: the
 * interface member walk took a literal name and dropped everything else, so a
 * computed key never reached the record - even though a Property Type Record's
 * [[Key]] has been "a String or a Symbol" since it was widened.
 *
 * `[k]: T` is a COMPUTED PROPERTY NAME rather than an index signature - an
 * index signature needs an identifier and a `:` INSIDE the brackets - so the
 * key has to be evaluated, which is what this cycle added.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('a symbol-keyed member is a REAL member of the interface', () => {
  // Its presence is required, which is the observable that says the record
  // received it: before this the declaration merged and left nothing behind, so
  // an empty object satisfied the interface.
  expect(outcome('const k = Symbol("k"); partial interface ClassFieldMetadata { [k]: string; } let m: ClassFieldMetadata = {};')).toBe('TypeError');
  // Supplying it satisfies the interface and round-trips.
  expect(evaluated('const k = Symbol("k"); partial interface ClassFieldMetadata { [k]: string; } let m: ClassFieldMetadata = { [k]: "ok" }; m[k];')).toBe('ok');
  // And an OPTIONAL symbol member is optional, so the marker is carried too.
  expect(evaluated('const k = Symbol("k"); partial interface ClassFieldMetadata { [k]?: string; } let m: ClassFieldMetadata = {}; String(m[k]);')).toBe('undefined');
});

test('symbol IDENTITY is what distinguishes members, not the description', () => {
  // Two symbols of the same description are different keys, so both may be
  // declared - which a description-keyed implementation would have rejected as
  // a duplicate. This is the property that makes a symbol key a collision
  // escape hatch at all.
  expect(outcome('const a = Symbol("x"), b = Symbol("x"); '
    + 'partial interface ClassFieldMetadata { [a]: string; } partial interface ClassFieldMetadata { [b]: string; }')).toBe('ACCEPTED');
  // The SAME symbol twice is the conflict a string-keyed member would be:
  // "two declarations of one member is a conflict rather than a merge".
  expect(outcome('const a = Symbol("x"); '
    + 'partial interface ClassFieldMetadata { [a]: string; } partial interface ClassFieldMetadata { [a]: string; }')).toBe('TypeError');
});

test('a user interface gets the same treatment, not just the intrinsics', () => {
  // The walk is one walk; the metadata intrinsics are ordinary interfaces that
  // a partial happens to target. Worth asserting so the fix is not read as
  // special-casing them.
  expect(outcome('const k = Symbol("k"); interface I { [k]: string; } let m: I = {};')).toBe('TypeError');
  expect(evaluated('const k = Symbol("k"); interface I { [k]: string; } let m: I = { [k]: "ok" }; m[k];')).toBe('ok');
});

test('PINNED: the TYPE judgment still reads string keys only', () => {
  // The half that remains. A store through a symbol key is unchecked where a
  // store through a string key is refused, and the pair is asserted together
  // because the string case is what says the difference is the KEY rather than
  // the rule. Same for a wrong type supplied at construction.
  const decl = 'const k = Symbol("k"); partial interface ClassFieldMetadata { [k]: string; } ';
  expect(evaluated(`${decl} let m: ClassFieldMetadata = { [k]: "ok" }; try { m[k] = 5; "ACCEPTED"; } catch (e) { e.constructor.name; }`)).toBe('ACCEPTED');
  expect(outcome('partial interface ClassFieldMetadata { s: string; } let m: ClassFieldMetadata = { s: "ok" }; m.s = 5;')).toBe('TypeError');
  expect(outcome(`${decl} let m: ClassFieldMetadata = { [k]: 5 };`)).toBe('ACCEPTED');
});
