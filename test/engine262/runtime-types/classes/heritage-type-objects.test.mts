import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Spec: #sec-typed-classes.
 *
 * "It is a type error for a ClassHeritage expression to have ... a reliable
 * typed invocation origin establishing that the value is not a constructor.
 * The invocation-origin judgment used for new also applies here." The alias
 * spelling `type A = uint8; class B extends A {}` was refused; the direct
 * `class B extends uint8 {}` was not, because the built-in-name proof
 * declines any name with a class ancestor, and a heritage expression always
 * has its own class as one. The owning class is transparent to that scan: its
 * heritage is evaluated once, in the enclosing scope, in statement order.
 */

test('a class extending a built-in Type Object written directly is refused', () => {
  for (const source of ['class B extends uint8 {}', 'class B extends string {}', 'class B extends float32x4 {}']) {
    expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-proposal-construction', phase: 'static' } });
  }
});

test('a shadowed, reassigned, or function-local name, and an ordinary class, are unchanged', () => {
  expect(evaluated('function f() { const uint8 = class {}; class B extends uint8 {} } "ok";')).toBe('ok');
  expect(evaluated('uint8 = class {}; class B extends uint8 {} "ok";')).toBe('ok');
  expect(evaluated('function g() { class B extends uint8 {} } "ok";')).toBe('ok');
  expect(evaluated('class A {} class B extends A {} "ok";')).toBe('ok');
  expect(evaluated('const K = class {}; class B extends K {} "ok";')).toBe('ok');
});
