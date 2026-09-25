import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * `return i` IN A FUNCTION NESTED IN THE LOOP, for a PLAIN function.
 *
 * A `return` in the function containing the loop reads the checker's return-type
 * stack. A function nested in the loop is not entered when the pre-pass runs, so the
 * stack still holds the OUTER function's type - reading it there would be wrong - and
 * such a return asked for nothing.
 *
 * The checker computes a function's return context inline, with unwrapping for
 * `async` (the promise's resolution), generators (the return type), predicates
 * (`boolean`) and contextual types. Recomputing that for a nested function risks
 * drifting from it. For a PLAIN function - not `async`, not a generator - whose return
 * annotation is written and is not a predicate, the context is exactly the annotation,
 * so it is read and nothing is recomputed. That covers a nested `return i` and the
 * concise `(): uint8 => i`. Every other nested function still asks for nothing; the
 * run time converts at its return.
 */

const T = "let t = '';";
const L = (fn: string) => `${T} for (const i of 0..<3) { ${fn} t = String(Reflect.typeOf(i)); } t;`;

test('a return in a plain nested function is a source of inference', () => {
  expect(evaluated(L('const f = (): uint8 => { return i; };'))).toBe('uint.<8>');
  expect(evaluated(L('const f = function (): uint8 { return i; };'))).toBe('uint.<8>');
});

test('so is the body of a concise arrow', () => {
  expect(evaluated(L('const f = (): uint8 => i;'))).toBe('uint.<8>');
});

test('the range is checked against the nested return type before the program runs', () => {
  expectStaticTypeError('for (const i of 0..<300) { const f = (): uint8 => i; }');
});

test('the nested function\'s own type is read, not the enclosing one', () => {
  // THE OWN-TYPE GUARD. The loop sits in a function returning `uint16`; the nested
  // arrow returns `uint8`, and `i` has no other use. Reading the stack - the outer
  // function's type - would make `i` a `uint16`.
  expect(evaluated(`${T} function h(): uint16 { for (const i of 0..<3) { const f = (): uint8 => i; `
    + 't = String(Reflect.typeOf(i)); } return 0; } h(); t;')).toBe('uint.<8>');
});

test('a nested function that is not plain asks for nothing', () => {
  // Its return context is unwrapped by the checker, and is not recomputed here.
  expect(evaluated(L('const f = async (): Promise.<uint8> => i;'))).toBe('number');
  expect(evaluated(L('const f = function* (): Generator.<uint8, uint8, void> { return i; };'))).toBe('number');
});

test('an unannotated nested function asks for nothing', () => {
  expect(evaluated(L('const f = () => i;'))).toBe('number');
});

test('a nested return that disagrees with another use asks for nothing', () => {
  expect(evaluated(`${T} function h(): uint16 { for (const i of 0..<3) { const f = (): uint8 => i; `
    + 't = String(Reflect.typeOf(i)); return i; } return 0; } h(); t;')).toBe('number');
});
