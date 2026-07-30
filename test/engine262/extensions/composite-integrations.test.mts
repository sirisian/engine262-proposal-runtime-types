import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-composites.md phase six: the integrations.
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

test('PINNED: hasInstance, and the JSON and structured-clone mappings', () => {
  // `Composite[%Symbol.hasInstance%]` is specified beside the matcher so that
  // `instanceof` answers membership; it is not wired, so `instanceof` falls back
  // to the ordinary prototype walk against a function with no `prototype`.
  expect(outcome('Composite({ x: 1 }) instanceof Composite;')).toBe('TypeError');
  // The JSON and structured clone mappings - "data on the wire, re-interned on
  // read" - are the last piece of the extension.
  expect(evaluated('JSON.stringify(Composite({ x: 1 }));')).toBe('{"x":1}');
  expect(evaluated('String(Composite.isComposite(JSON.parse(JSON.stringify(Composite({ x: 1 })))));')).toBe('false');
});
