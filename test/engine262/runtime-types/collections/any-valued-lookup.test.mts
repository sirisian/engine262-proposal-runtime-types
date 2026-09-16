import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown, ok } from '../harness.mts';

/**
 * A lookup that may miss on a collection whose value type is `any`.
 *
 * `Map.<K, V>.get(k)` is `V | undefined`, and for `V = any` that union IS `any`:
 * #sec-canonicalizetype absorbs a member into any member it is a subtype of, and
 * every type is a subtype of `any` (#sec-issubtype). The run time interns it
 * that way. The checker built the union raw and read it as a two-arm type, so
 * `undefined` reached IsSubtype's union rule on its own and NarrowFrom saw a
 * type whose only non-`any` arm is `undefined` - a nullish test on which "can
 * never fail". Both are the checker disagreeing with the type the run time
 * interns for the same source.
 */

test('a lookup on an any-valued Map is any', () => {
  // Assignable as `any` is, and no dead-code report on the nullish test.
  expect(ok('let m: Map.<string, any> = new Map.<string, any>(); m.set("a", 1); let s: string = m.get("a");')).toBe(true);
  expect(ok('let m: Map.<string, any> = new Map.<string, any>(); let x = m.get("a") ?? [];')).toBe(true);
  // A Map keyed by TYPE, the shape the design's EventBus is built on.
  expect(evaluated('let m: Map.<type, any> = new Map.<type, any>(); m.set(uint8, [1]); String((m.get(uint8) ?? []).length);')).toBe('1');
  expect(evaluated('let m: Map.<type, any> = new Map.<type, any>(); String((m.get(uint8) ?? []).length);')).toBe('0');
});

test('a written `any | undefined` is `any` too', () => {
  expect(ok('let v: any | undefined = 1; let s: string = v;')).toBe(true);
  expect(ok('let v: any | undefined = 1; let x = v ?? 2;')).toBe(true);
  expect(ok('function g(): any | undefined { return 1; } let x = g() ?? 2;')).toBe(true);
});

test('a typed lookup keeps its undefined arm', () => {
  // The absorption is `any`'s alone; `V | undefined` for a real `V` still
  // says a miss is possible, which is what makes `?? 0` meaningful here...
  expect(ok('let m: Map.<string, uint8> = new Map.<string, uint8>(); let x: uint8 = m.get("a") ?? 0;')).toBe(true);
  // ...and a value that cannot be nullish is still reported for a dead test.
  expectStaticTypeError('let d: uint8 = 0; let x = d ?? 5;');
});

test('the written order of a union survives into diagnostics', () => {
  // Only `any` absorbs. Every other union is kept as written, so a message
  // names the type the author spelled rather than the interned ordering.
  expectThrown('let x: uint8 | string;', '"uint.<8> | string" has no default value');
});
