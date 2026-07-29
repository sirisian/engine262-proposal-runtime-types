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

test('MEMBERSHIP handles symbol keys; the STATIC CHECKER is what does not', () => {
  // Cycle 148 recorded this as "the structural walk reads string keys only".
  // That was wrong, and the correction matters for what closing it takes: the
  // run-time membership judgment reads symbol keys CORRECTLY - it builds a
  // property key from the record's key, string or symbol - and `is` answers
  // both directions for both kinds.
  const S = 'const k = Symbol("k"); interface I { [k]: string; } ';
  expect(evaluated(`${S} String({ [k]: "ok" } is I);`)).toBe('true');
  expect(evaluated(`${S} String({ [k]: 5 } is I);`)).toBe('false');
  expect(evaluated('interface J { s: string; } String({ s: 5 } is J);')).toBe('false');
});

test('PINNED: interface member types are enforced STATICALLY, and only so', () => {
  // The refusals this suite reads as "enforcement" are the CHECKER's, and they
  // stop where the checker's view stops - for STRING keys just as much as
  // symbol ones. Through a function parameter, or from a value the checker
  // types as `any`, a wrong store is accepted with either kind of key.
  //
  // So the symbol gap is not "the runtime checks strings and not symbols". It
  // is that the CHECKER cannot judge a symbol-keyed member at all, and that is
  // a design question rather than a missing branch: a symbol's IDENTITY is not
  // statically knowable. Matching by the binding a computed key names would be
  // the tractable rule, and matching by DESCRIPTION would repeat exactly the
  // collision the symbol key exists to prevent - which is why this is left for
  // a decision rather than guessed at here.
  const T = 'interface J { s: string; } ';
  const S = 'const k = Symbol("k"); interface I { [k]: string; } ';
  const outcome2 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  // What the checker sees, it refuses - for a string key.
  expect(outcome2(`${T} let m: J = { s: "ok" }; m.s = 5;`)).toBe('TypeError');
  expect(outcome2(`${T} let m: J = { s: 5 };`)).toBe('TypeError');
  // What it does not see, it does not - ALSO for a string key. This is the
  // assertion that says the gap is the checker's reach and not the key.
  expect(outcome2(`${T} function f(o) { o.s = 5; } let m: J = { s: "ok" }; f(m);`)).toBe('ACCEPTED');
  expect(outcome2(`${T} function g(v) { let m: J = v; return m; } g({ s: 5 });`)).toBe('ACCEPTED');
  // And a symbol key is unjudged in the positions a string key IS judged.
  expect(outcome2(`${S} let m: I = { [k]: "ok" }; m[k] = 5;`)).toBe('ACCEPTED');
  expect(outcome2(`${S} let m: I = { [k]: 5 };`)).toBe('ACCEPTED');
});
