import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Question AP, AP4: a store the seal refuses on a typed instance is a TypeError in every mode.
 *
 * An instance of a typed class is sealed when it is constructed (#sec-typed-classes), and a store
 * that would add a property its class does not declare cannot succeed. Where the checker sees the
 * receiver's class it refuses the store before running; where it does not - untyped code, a
 * receiver of type `any`, a class over a built-in - the store reached the seal, which threw in
 * strict code and stored nothing in sloppy code. The neighbouring failures already threw in every
 * mode: deleting a typed field, a store of the wrong type, and a store to a frozen typed instance.
 */

test('a store that would add a member to a typed instance throws in sloppy code', () => {
  for (const cls of [
    'class V { x: uint8 = 0; }',
    'value class V { x: uint8 = 0; }',
    'class V extends Error { code: uint8 = 0; }',
    'class V extends Map { n: uint8 = 0; }',
    'class V extends Array { n: uint8 = 0; }',
  ]) {
    expectThrown(`${cls} function g(o) { o.extra = 1; } g(new V());`, 'Cannot set property "extra"');
  }
  // A member the instance inherits as a data property is added as its own by a store, which the
  // seal refuses as well; a class that means to set it declares it.
  expectThrown('class E extends Error { code: uint8 = 0; } function g(o) { o.name = "Z"; } g(new E());', 'Cannot set property "name"');
  expect(evaluated('class E extends Error { name = "E"; code: uint8 = 0; } function g(o) { o.name = "Z"; return o.name; } g(new E());')).toBe('Z');
  // Reflect.set is a store too.
  expectThrown('class V { x: uint8 = 0; } Reflect.set(new V(), "extra", 1);', 'Cannot set property "extra"');
});

test('a declared member, a dynamic class and an untyped object are unchanged', () => {
  expect(evaluated('class V { x: uint8 = 0; } function g(o) { o.x = 7; return o.x; } String(g(new V()));')).toBe('7');
  expect(evaluated('dynamic class V { x: uint8 = 0; } function g(o) { o.extra = 1; return o.extra; } String(g(new V()));')).toBe('1');
  expect(evaluated('class U { x = 0; } function g(o) { o.extra = 1; return o.extra; } String(g(new U()));')).toBe('1');
  // An untyped object made non-extensible keeps JavaScript's silent failure in sloppy code.
  expect(evaluated('function g(o) { o.extra = 1; return String(o.extra); } g(Object.seal({ x: 0 }));')).toBe('undefined');
  // A typed instance on the prototype chain of an ordinary object does not stop a store to that object.
  expect(evaluated('class V { x: uint8 = 0; } const o = Object.create(new V()); o.extra = 1; String(o.extra);')).toBe('1');
  // An inherited setter still runs.
  expect(evaluated('let seen = 0; class V { x: uint8 = 0; set s(v) { seen = v; } } function g(o) { o.s = 5; } g(new V()); String(seen);')).toBe('5');
});
