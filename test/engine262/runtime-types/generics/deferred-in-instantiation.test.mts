import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A DEFERRED OPERATOR INSIDE AN INSTANTIATED INTERFACE.
 *
 * `keyof T` and `T[K]` are ~deferred~ records waiting on the parameters they
 * name. `substituteTypeParameters` reaches into one; the runtime walk
 * `SubstituteTypeArguments`, which `objectLiteralShape` reads a nominal's members
 * through, had no arm for the kind - so `H.<P>` for
 * `interface H<T> { get?(t: T, k: keyof T): T[keyof T] }` substituted `t: T` and
 * left `k: keyof T` as written, and a literal adopting that shape was checked
 * against a target that named different types for the same member.
 */

const P = 'type P = { a: uint8, b: string }; ';

test('a member using keyof T and T[keyof T] is instantiated fully', () => {
  const H = 'interface H<T: type> { get?(t: T, k: keyof T): T[keyof T]; } ';
  expect(evaluated(`${P}${H}let h: H.<P> = { get(t, k) { return t[k]; } }; \`\${typeof h}\`;`)).toBe('object');
  expectThrown(`${P}${H}let h: H.<P> = { get(t, k) { return true; } };`, 'is not assignable to "string | uint.<8>"');
});

test('a generic member over the instantiated parameter is too', () => {
  // The exact per-key form: K ranges over P's keys once T is P, and the return
  // is P[K]. This is what an exact `ProxyHandler.<T>` trap wants to say.
  const H = 'interface H<T: type> { get?<K: keyof T>(t: T, k: K): T[K]; } ';
  expect(evaluated(`${P}${H}let h: H.<P> = { get(t, k) { return t[k]; } }; \`\${typeof h}\`;`)).toBe('object');
  expectThrown(`${P}${H}let h: H.<P> = { get(t, k) { return true; } };`, 'is not assignable to "{ a: uint.<8>, b: string }[K]"');
  expect(evaluated(`${P}${H}let h: H.<P> = {}; \`\${typeof h}\`;`)).toBe('object');
});
