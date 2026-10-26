import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Spec: #sec-void-type.
 *
 * "It is a type error if an actual binding declaration resolves to the void
 * type, independently of whether it has an initializer or that initializer is
 * statically known." A `const` adopts a participating initializer's type, so
 * `const y = f()` for `f(): void` resolves to void; the run time refused the
 * store, and now the checker refuses the declaration. An untyped `let` is a
 * position the clause admits a void value to reach.
 */

test('a const whose inferred type is void is refused before the body', () => {
  for (const source of [
    'function f(): void {} const y = f();',
    'function f(): void {} function g() { return f(); } const z = g();',
  ]) {
    expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-void-use', phase: 'static' } });
  }
});

test('an untyped let and a const of undefined are unchanged', () => {
  expect(evaluated('function f(): void {} let y = f(); "ok";')).toBe('ok');
  expect(evaluated('const y = undefined; String(y);')).toBe('undefined');
});
