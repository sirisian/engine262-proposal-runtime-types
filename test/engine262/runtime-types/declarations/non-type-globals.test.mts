import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5 follow-up, Q14: a name in a type position that reaches, by a proved
 * origin, a built-in namespace object is not a type, and is refused before the
 * body with that said (rt-type-required), rather than a closed annotation
 * failing to evaluate at pre-evaluation. A name the program declares, or a
 * global it replaces, is left alone.
 */

test('a built-in namespace object named as a type is refused before the body', () => {
  for (const name of ['Math', 'JSON', 'Reflect', 'Atomics']) {
    expect(observeScript(`let x: ${name};`)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-type-required', phase: 'static' } });
  }
});

test('a declared or replaced name is not the built-in', () => {
  expect(evaluated('const Math = uint8; let x: Math = 1; String(x);')).toBe('1');
  expect(evaluated('function f(Math: type) { let x: Math; return 1; } String(f(uint8));')).toBe('1');
  expect(evaluated('globalThis.Math = uint8; let x: Math = 1; String(x);')).toBe('1');
});
