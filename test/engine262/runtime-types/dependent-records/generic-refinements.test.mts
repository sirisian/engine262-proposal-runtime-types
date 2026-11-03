import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-where-clauses: an application of a generic alias whose clause reads
 * `this` refines the applied base with the declaration's predicate, under the
 * application's bindings, and every boundary and `is` enforces it as for a
 * non-generic refinement.
 */

const NE = 'type NE<T: type> = T where this.length > 0;';

test('is consults an application\'s predicate', () => {
  expect(evaluated(`${NE} String('' is NE.<string>);`)).toBe('false');
  expect(evaluated(`${NE} String('x' is NE.<string>);`)).toBe('true');
  expect(evaluated("type NE = string where this.length > 0; String('' is NE);")).toBe('false');
});

test('a boundary enforces an application\'s predicate', () => {
  expect(evaluated(`${NE} let b: NE.<string> = 'x'; b;`)).toBe('x');
  expect(observeScript(`${NE} let b: NE.<string> = '';`)).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
  expect(evaluated(`${NE} const s: any = ''; let m = 'none'; try { let b: NE.<string> = s; m = 'ran'; } catch (e) { m = 'threw'; } m;`)).toBe('threw');
});

test('a clause that reads a value parameter is evaluated under the application\'s bindings', () => {
  const Below = 'type Below<N: uint32> = uint32 where this < N;';
  expect(evaluated(`${Below} String((5 := uint32) is Below.<10>);`)).toBe('true');
  expect(evaluated(`${Below} String((15 := uint32) is Below.<10>);`)).toBe('false');
  expect(evaluated(`${Below} String((15 := uint32) is Below.<20>);`)).toBe('true');
});

test('a generic alias whose clauses do not read this is unchanged', () => {
  expect(evaluated("type A<N: uint32> = [N].<uint8> where N > 2; let a: A.<3>; 'ok';")).toBe('ok');
});
