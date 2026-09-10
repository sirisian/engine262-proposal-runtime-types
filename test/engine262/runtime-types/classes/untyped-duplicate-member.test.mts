import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Two members of one name with NO annotation between them are not an overload
 * set. They are one member declared twice, and the base language says the later
 * wins.
 *
 * This was a COMPATIBILITY BREAK. `class C { m() { return 1; } m() { return 2; } }`
 * is ordinary JavaScript that evaluates to 2, and with the feature on it threw:
 * the two arms were collected into an overload set, their (absent) parameter
 * types were identical, and every call was ambiguous. No annotation appeared
 * anywhere in the program.
 *
 * The gate is the one `#sec-constructor-overloading` states for a constructor:
 * "The annotation is what admits the set. A class body carrying no annotation on
 * any constructor parameter is exactly what it was." That is a rule about
 * members, and this applies it to the rest of them.
 *
 * Both phases needed it. The CHECKER accumulates signatures per member key
 * (`check.mts`, guarded on the `Untyped` flag it already recorded), and the
 * RUNTIME builds an overloaded function when a method finds one of its name
 * already on the home object (`MethodDefinitionEvaluation.mts`). Fixing one left
 * the other throwing.
 */

test('a duplicate untyped method behaves as the base language says', () => {
  expect(evaluated('class C { m() { return 1; } m() { return 2; } } String(new C().m());')).toBe('2');
  expect(evaluated('class C { m(a) { return 1; } m(a) { return 2; } } String(new C().m(1));')).toBe('2');
  expect(evaluated('class C { static m() { return 1; } static m() { return 2; } } String(C.m());')).toBe('2');
});

test('...and so does a duplicate member of an object literal', () => {
  // A different path from the class body, with its own message, so it needed the
  // same gate rather than inheriting one.
  expect(evaluated('const o = { m() { return 1; }, m() { return 2; } }; String(o.m());')).toBe('2');
});

test('one annotation anywhere still makes an overload set', () => {
  // The gate admits the set, so a real overload set is untouched: these resolve
  // rather than collapsing to the later declaration.
  expect(evaluated('class C { m(a: uint8) { return 1; } m(a) { return 2; } }'
    + ' String(new C().m((1 := uint8)));')).toBe('1');
  expect(evaluated('class C { m(a: uint8) { return 1; } m(a: string) { return 2; } }'
    + ' String(new C().m("s"));')).toBe('2');
  expect(evaluated('const o = { m(a: uint8) { return 1; }, m(a: string) { return 2; } };'
    + ' String(o.m("s"));')).toBe('2');
});

test('members of different kinds are unaffected', () => {
  // A getter and a method of one name were already keyed apart and never formed a
  // set; this is here so a future change to the gate cannot quietly merge them.
  expect(evaluated('class C { get m() { return 1; } m() { return 2; } } String(new C().m());')).toBe('2');
});
