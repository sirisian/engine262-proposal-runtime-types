import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-object-types.
 *
 * "an object literal written AT the position is fresh and is being built there,
 * so the type supplies what the literal omits".
 *
 * It supplied only what the CHECKER could fold. A member default is recorded as
 * a value when it folds to a literal and as its source otherwise, and both the
 * mark that says "this literal has defaults to fill" and the fill itself tested
 * the value alone. So `{ m?: uint8 = 5 }` filled and `{ m?: any = new Map() }`,
 * `{ m?: any = {} }` and `{ m?: uint8 = Math.max(1, 2) }` filled nothing - the
 * author wrote a default, got none, and was told nothing.
 *
 * The same defaults were already filling for a tuple position and for
 * `Composite.<I>({})`, because those read records the RUNTIME resolver built,
 * which evaluates. This was the one path reading the checker's record.
 */

test('a member default that is not a literal fills', () => {
  expect(evaluated('type T = { m?: any = new Map() }; let t: T = {}; String(t.m instanceof Map);')).toBe('true');
  expect(evaluated('type T = { m?: uint8 = Math.max(1, 2) }; let t: T = {}; String(t.m);')).toBe('2');
  expect(evaluated('type T = { m?: any = {} }; let t: T = {}; typeof t.m;')).toBe('object');
  expect(evaluated('type T = { m?: any = [] }; let t: T = {}; String(t.m.length);')).toBe('0');
  expect(evaluated('type T = { m?: Map.<string, uint8> = new Map() }; let t: T = {}; String(t.m instanceof Map);')).toBe('true');
});

test('the spelling of the type does not matter', () => {
  // An interface member and the same member written in an object type "are one
  // thing", and an inline annotation is the third spelling.
  expect(evaluated('interface I { m?: any = new Map() } let t: I = {}; String(t.m instanceof Map);')).toBe('true');
  expect(evaluated('let t: { m?: any = new Map() } = {}; String(t.m instanceof Map);')).toBe('true');
});

test('a default is a constant of the program, not a fresh value per literal', () => {
  // It is evaluated in the compile-time-evaluable fragment, and the value it
  // produces is shared - which is what a tuple position and a composite already
  // do, so filling a fresh one here would have made this the one spelling that
  // differed.
  expect(evaluated('type T = { m?: any = new Map() }; let a: T = {}; let b: T = {}; String(a.m === b.m);')).toBe('true');
  expect(evaluated('type T = [any = new Map()]; let a: T = []; let b: T = []; String(a[0] === b[0]);')).toBe('true');
  expect(evaluated('interface I { m?: any = new Map() } '
    + 'let a = Composite.<I>({}); let b = Composite.<I>({}); String(a.m === b.m);')).toBe('true');
});

test('what filled before still fills, and a supplied value still wins', () => {
  expect(evaluated('type T = { m?: uint8 = 5 }; let t: T = {}; String(t.m);')).toBe('5');
  expect(evaluated('type T = { m?: uint8 = 5 }; let t: T = { m: 9 }; String(t.m);')).toBe('9');
  // "AFTER the members, so a supplied value always wins and a default only
  // fills what the literal left out."
  expect(evaluated('type T = { m?: any = new Map() }; let t: T = { m: 1 }; String(t.m);')).toBe('1');
});

test('a member with no default is still absent', () => {
  expect(evaluated("type T = { m?: uint8 }; let t: T = {}; String('m' in t);")).toBe('false');
  expect(evaluated('type T = { m: uint8 }; let t: T = { m: 3 }; String(t.m);')).toBe('3');
});

test('a default outside the fragment is still refused', () => {
  // The fill evaluates, so the library half of #annex-evaluable-fragment
  // reaches it: an excluded built-in is refused at the call, wherever the call
  // came from.
  expectThrownKind('type T = { m?: any = new Date() }; let t: T = {};', 'TypeError');
});
