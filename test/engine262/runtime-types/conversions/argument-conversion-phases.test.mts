import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * How an ARGUMENT reaches a typed parameter, and in which phase it is refused.
 *
 * Three paths decide this, and nothing states them together, so each is
 * surprising when met alone:
 *
 *   - a FRESH object literal is taken apart and its members checked against the
 *     target, which is why `{ n: 1 }` fills `{ n: uint8 }` at all;
 *   - an argument with a STATIC TYPE crosses by assignability, and
 *     `{ n: number }` is not assignable to `{ n: uint8 }`;
 *   - an argument typed ~any~ is not checked.
 *
 * The temptation is to read the difference as being about FROZEN objects,
 * because `f(Object.freeze({ n: 1 }))` is refused where `f({ n: 1 })` is not.
 * It is not about freezing, and two of the tests below exist only to say so.
 */

const F = 'function f(y: { n: uint8 }) { return 1; } ';

test('a FRESH object literal is checked member by member', () => {
  // The path that makes a typed parameter usable with a literal at all: the
  // literal is taken apart and each member converted, rather than the whole
  // being asked whether it is assignable.
  expect(evaluated(`${F} String(f({ n: 1 }));`)).toBe('1');
  // An unannotated binding keeps that treatment - the binding does not give the
  // literal a static type, so nothing erases its freshness.
  expect(evaluated(`${F} const o = { n: 1 }; String(f(o));`)).toBe('1');
});

test('an argument with a STATIC TYPE crosses by assignability', () => {
  // ...and `{ n: number }` is not assignable to `{ n: uint8 }`, which
  // `Reflect.isAssignable` answers *false* for. Refused BEFORE the program runs.
  expect(evaluated('String(Reflect.isAssignable(type { n: number }, type { n: uint8 }));')).toBe('false');
  // An annotation is enough. This is the control for the frozen rows below: the
  // object is an ordinary unfrozen literal and it is still refused.
  expectStaticTypeError(`${F} const o: { n: number } = { n: 1 }; f(o);`);
  // A declared RETURN type is enough, and this one freezes nothing at all - which
  // is what shows the refusal is about the static type rather than about frozen
  // objects.
  expectStaticTypeError(`${F} function id(x: { n: number }): { n: number } { return x; } f(id({ n: 1 }));`);
  // `Object.freeze` is refused for that same reason and no other.
  expectStaticTypeError(`${F} f(Object.freeze({ n: 1 }));`);
  expectStaticTypeError(`${F} const o: { n: number } = Object.freeze({ n: 1 }); f(o);`);
});

test('an argument typed `any` is not checked', () => {
  // An unannotated function returns ~any~, so putting one in the middle makes the
  // same program legal. Pinned because it reads as a bug until the row above is
  // in view: the difference is the declared return type, not the call.
  expect(evaluated('function id(x) { return x; } String(Reflect.typeOf(id));')).toBe('(x: any) => void');
  expect(evaluated(`${F} function id(x) { return x; } String(f(id({ n: 1 })));`)).toBe('1');
});

test('a FROZEN argument needing no conversion is accepted', () => {
  // The other half of "it is not about freezing": a frozen object whose member is
  // already the target's type crosses without complaint, because nothing has to
  // be written.
  expect(evaluated(`${F} String(f(Object.freeze({ n: (1 := uint8) })));`)).toBe('1');
  expect(evaluated(`${F} const o = Object.freeze({ n: (1 := uint8) }); String(f(o));`)).toBe('1');
});

test('a frozen argument that DOES need conversion is refused at the boundary', () => {
  // The one runtime case. The fresh path survived the checker - an unannotated
  // binding of a call result keeps it - and the in-place conversion then failed
  // because the object is frozen.
  expectThrown(`${F} const o = Object.freeze({ n: 1 }); f(o);`,
    'cannot be converted to "uint.<8>" in place, because it is not writable');
  // Refusing rather than copying is W1, and this is what it buys: the callee
  // receives the SAME object, so a conversion that cannot happen in place cannot
  // be papered over with a copy.
  expect(evaluated('function g(x: { n: uint8 }) { return x; } const o = { n: 1 }; String(g(o) === o);')).toBe('true');
  // `Object.seal` is ACCEPTED here, and that is the sharpest evidence for what
  // the obstacle is: sealing prevents adding and removing properties and leaves
  // the existing ones WRITABLE, so the in-place conversion succeeds. The refusal
  // is not about frozen-ness as a category, nor about extensibility - it is about
  // whether this property can be written.
  expect(evaluated(`${F} const o = Object.seal({ n: 1 }); String(f(o));`)).toBe('1');
  // ...and a non-writable property refuses without any freezing at all.
  expect(evaluated(`${F} const o = {}; Object.defineProperty(o, "n", { value: 1, writable: false, enumerable: true, configurable: true });`
    + ' try { f(o); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('the two refusals differ in PHASE, and the static one reaches a dead branch', () => {
  // This is the asymmetry worth knowing about. A static refusal is decided before
  // the text runs, so it fires for code that never executes; the boundary refusal
  // cannot, because no boundary is crossed.
  expectStaticTypeError(`${F} if (false) { f(Object.freeze({ n: 1 })); }`);
  expect(evaluated(`${F} if (false) { const o = Object.freeze({ n: 1 }); f(o); } "reached";`)).toBe('reached');
  // So the frozen-behind-an-unannotated-binding case is the only refusal here a
  // program can carry without being told. The gap is easy to OVERSTATE: the
  // inline form is rejected statically, but for an unrelated reason - a declared
  // return type puts it on the assignability path - so only a binding with no
  // annotation escapes both.
  //
  // Recorded as a limit rather than hidden. Deciding it earlier would mean
  // tracking frozen-ness through a binding, and frozen-ness is a property of a
  // VALUE rather than of its type: the checker has no notion of it anywhere.
});
