import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

/**
 * Spec: #sec-user-defined-operators.
 *
 * "The receiver is the left operand and the declaration's parameter is the
 * right"; a unary operator has no parameter; a static declaration's receiver
 * is the class object and takes the same count. A count that fits no form of
 * the token is a Syntax Error at the
 * declaration. It was accepted, and surfaced at a use as a missing argument.
 */

test.each([
  'class C { operator +(a: C, b: C, c: C): C { return a; } }',
  'class C { operator *(): C { return this; } }',
  'class C { operator <(a: C, b: C): boolean { return true; } }',
  'class C { operator !(o: C): boolean { return true; } }',
  'class C { operator +(...o: [].<C>): C { return this; } }',
  'class C { operator +=(): C { return this; } }',
  'class C { static operator *(a: C, b: C): C { return a; } }',
])('a parameter count that fits no form is refused: %s', (source) => expectEarlyError(source, 'SyntaxError'));

test('each admitted form parses and applies', () => {
  expect(evaluated('class C { operator +(o: C): C { return this; } } const c = new C(); String((c + c) instanceof C);')).toBe('true');
  expect(evaluated('class C { operator -(): C { return this; } } const c = new C(); String((-c) instanceof C);')).toBe('true');
  expect(evaluated('class C { static operator +(b: C): C { return b; } } "ok";')).toBe('ok');
  expect(evaluated('class C { operator ++(): C { return this; } operator +=(o: C): C { return this; } } "ok";')).toBe('ok');
});
