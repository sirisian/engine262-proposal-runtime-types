import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * proposal-runtime-types `#sec-type-names`, the host boundaries.
 *
 * The clause makes ADMITS TYPE NAMES a property of the source text, so every place
 * a new source text comes into being needs an answer, and the clause gives one
 * rather than leaving it to implementations: "Code passed to `eval` or the
 * `Function` constructor is a source text of its own and admits on its own terms;
 * a direct `eval` ALSO admits where the text it runs inside does. An indirect
 * `eval` and the `Function` constructor take only their own, since there is no
 * enclosing text they run inside."
 *
 * Each of the three was wrong at some point while this was built, in a different
 * way, which is why all three are pinned here rather than sampled.
 */

test('a direct eval admits on its own terms', () => {
  // The eval'd text carries type syntax of its own, and the caller has none. An
  // earlier draft read this as pure inheritance and denied it on the caller's
  // behalf.
  expect(evaluated(`String(eval('let a: uint8 = 1; typeof uint8'));`)).toBe('object');
  expect(evaluated(`String(eval('uint64.byteLength'));`)).toBe('8');
});

test('a direct eval ALSO admits where the text it runs inside does', () => {
  // The other half of the union: a bare name inside the eval resolves where it
  // would resolve just outside it.
  expect(evaluated('let outer: uint8 = 1; String(eval("uint64.byteLength"));')).toBe('8');
});

test('an indirect eval takes only its own terms', () => {
  expect(evaluated('String((0, eval)("uint64.byteLength"));')).toBe('8');
  expect(evaluated('String((0, eval)("typeof string"));')).toBe('undefined');
  // and does NOT inherit, which is what separates it from the direct form
  expect(evaluated('let o: uint8 = 1; String((0, eval)("typeof string"));')).toBe('undefined');
});

test('a Function body takes only its own terms', () => {
  expect(evaluated('String(Function("return uint64.byteLength")());')).toBe('8');
  expect(evaluated('String(Function("let a: uint8 = 1; return typeof uint8")());')).toBe('object');
  expect(evaluated('String(Function("return typeof string")());')).toBe('undefined');
  // A dynamic function's [[ScriptOrModule]] is the text that CREATED it, so an
  // answer that merely overrode a positive would fall through to the caller here
  // and admit. The context's own answer is authoritative, not an override.
  expect(evaluated('let o: uint8 = 1; String(Function("return typeof string")());')).toBe('undefined');
});

test('the compatibility guarantee survives all of them', () => {
  // Nothing above may make a text that never mentioned a type admit.
  expect(evaluated('String(typeof string);')).toBe('undefined');
  expect(evaluated('var string = 5; String(string);')).toBe('5');
  expect(evaluated('string = 5; String(string);')).toBe('5');
});
