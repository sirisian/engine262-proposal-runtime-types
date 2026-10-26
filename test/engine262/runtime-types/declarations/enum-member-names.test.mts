import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Spec: #sec-enums.
 *
 * "It is a type error if two enumerators of one declaration have the same
 * name." The rule is syntactic, so it is judged at parse for every
 * declaration: a Module fails before any dependency body runs, and a
 * declaration in a body that never executes is refused too. The only
 * detection was the TypeError closed evaluation threw, which reached a
 * top-level declaration at the pre-evaluation boundary and a nested one never.
 */

test('a repeated enumerator name is refused at parse', () => {
  for (const source of ['enum E { A, A }', 'enum E { A = 1, B = 2, A = 3 }', 'enum E: string { A = "a", B = "b", A = "c" }']) {
    expect(observeScript(source)).toMatchObject({
      bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-enum-initializer', phase: 'static' },
    });
  }
});

test('a repeated name in an uncalled body is refused', () => {
  expect(observeScript('function f() { enum E { A, B, A } }')).toMatchObject({
    bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-enum-initializer', phase: 'static' },
  });
});

test('distinct names, and one value under several names, are accepted', () => {
  expect(evaluated('enum E { A, B } String(E.B);')).toBe('1');
  expect(evaluated('enum E { A = 1, B = 1 } String(E.A === E.B);')).toBe('true');
});
