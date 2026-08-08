import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-composite-canbeheldweakly, #sec-composite-custommatcher,
 * #sec-composite-hasinstance, #sec-composite-json - the integrations.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('a composite is refused in EVERY weak position', () => {
  // `sec-composite-canbeheldweakly`. The specification merges this with the
  // typed-instance refusal already there, "for the MIRROR-IMAGE reason, an
  // identity that coincides with contents rather than none at all": a typed
  // instance has no identity to observe, and an interned composite's identity IS
  // its contents, so neither has an identity-based lifetime a weak reference
  // could watch.
  expect(outcome('new WeakSet().add(Composite({ x: 1 }));')).toBe('TypeError');
  expect(outcome('new WeakMap().set(Composite({ x: 1 }), 1);')).toBe('TypeError');
  expect(outcome('new WeakRef(Composite({ x: 1 }));')).toBe('TypeError');
  expect(outcome('new FinalizationRegistry(() => {}).register(Composite({ x: 1 }), 1);')).toBe('TypeError');
  // A TUPLE composite too - the refusal is about being a composite, not about
  // the kind.
  expect(outcome('new WeakSet().add(Composite([1]));')).toBe('TypeError');
  // An ordinary object is untouched, which is what says the rule was narrowed
  // to composites rather than widened to frozen objects.
  expect(outcome('new WeakSet().add({});')).toBe('ACCEPTED');
  expect(outcome('new WeakSet().add(Object.freeze({}));')).toBe('ACCEPTED');
});

test('Composite[Symbol.customMatcher] tests membership with NO side effect', () => {
  // `sec-composite-custommatcher`: "Return IsComposite(subject)."
  expect(evaluated('String(typeof Symbol.customMatcher);')).toBe('symbol');
  expect(evaluated('String(typeof Composite[Symbol.customMatcher]);')).toBe('function');
  expect(evaluated('String(Composite[Symbol.customMatcher](Composite({ x: 1 })));')).toBe('true');
  expect(evaluated('String(Composite[Symbol.customMatcher](Composite([1])));')).toBe('true');
  expect(evaluated('String(Composite[Symbol.customMatcher]({}));')).toBe('false');
  expect(evaluated('String(Composite[Symbol.customMatcher](1));')).toBe('false');
  // THE ASSERTION THE METHOD EXISTS FOR. Without it, in an ecosystem whose
  // default matcher invokes a callable as a predicate, `when Composite:` would
  // CALL `Composite(subject)` - matching every object, RUNNING THE SUBJECT'S
  // GETTERS, and interning a composite as the side effect of a test. A getter
  // that never runs is what says the test reads nothing.
  expect(evaluated('let calls = 0; const o = { get g() { calls += 1; return 1; } }; '
    + 'Composite[Symbol.customMatcher](o); String(calls);')).toBe('0');
  // Non-enumerable, so it does not show among `Composite`'s own names.
  expect(evaluated('Object.getOwnPropertyNames(Composite).join(",");')).toBe('length,name,isComposite');
});

test('`instanceof` answers membership through hasInstance', () => {
  // `sec-composite-hasinstance`: "The Composite function has no *\"prototype\"*
  // property, so without this method `value instanceof Composite` would THROW
  // through OrdinaryHasInstance."
  expect(evaluated('String(Composite({ x: 1 }) instanceof Composite);')).toBe('true');
  expect(evaluated('String(Composite([1]) instanceof Composite);')).toBe('true');
  expect(evaluated('String({} instanceof Composite);')).toBe('false');
  expect(evaluated('String(1 instanceof Composite);')).toBe('false');
});

test('JSON: data on the wire, RE-INTERNED on read', () => {
  // `sec-composite-json`. Stringify needs no change - a record composite is an
  // object whose own enumerable properties are its contents, and a tuple
  // composite is an array.
  expect(evaluated('JSON.stringify(Composite({ x: 1, y: 2 }));')).toBe('{"x":1,"y":2}');
  expect(evaluated('JSON.stringify(Composite([1, 2]));')).toBe('[1,2]');
  // The TYPED PARSE re-interns, which is the half that needed code: "interning
  // is deliberately not on the wire; it is an identity within one heap, not a
  // serialization format". The assertion is IDENTITY with a locally-created
  // composite - a parse that merely produced the right shape would fail it.
  expect(evaluated('interface I { x: uint8 } String(Composite.isComposite(JSON.parse.<Composite.<I>>(\'{"x":1}\')));')).toBe('true');
  expect(evaluated('interface I { x: uint8 } String(JSON.parse.<Composite.<I>>(\'{"x":1}\') === Composite.<I>({ x: 1 }));')).toBe('true');
  // "The top composite type is rejected there, because it states no shape to
  // validate against."
  expect(outcome('JSON.parse.<Composite>(\'{"x":1}\');')).toBe('TypeError');
  // An UNTYPED parse still yields a plain object, which is what says the
  // re-interning belongs to the typed read rather than to `JSON.parse`.
  expect(evaluated('String(Composite.isComposite(JSON.parse(\'{"x":1}\')));')).toBe('false');
});
