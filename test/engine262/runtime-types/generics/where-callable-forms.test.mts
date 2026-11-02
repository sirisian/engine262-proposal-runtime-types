import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-annotations-on-the-remaining-function-forms and #sec-generic-where: a
 * method, a generator, an async function and a function expression take their
 * clauses the same way a function declaration does, so each clause is judged
 * at the declaration over the parameters' declared types.
 */

const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('every function form judges its clauses at the declaration', () => {
  for (const source of [
    'class K { m(i: uint8) where i > 300 { return i; } }',
    'class K { static m(i: uint8) where i > 300 { return i; } }',
    'class K { m<I: uint8>() where I > 300 { return I; } }',
    'const o = { m(i: uint8) where i > 300 { return i; } };',
    'const f = function (i: uint8) where i > 300 { return i; };',
    'function* g(i: uint8) where i > 300 { yield i; }',
    'async function f(i: uint8) where i > 300 { return i; }',
    'async function* f(i: uint8) where i > 300 { yield i; }',
    'class K { set x(v: uint8) where v > 300 { } }',
    'class K { get x(): uint8 where return > 300 { return 20; } }',
  ]) refused(source, 'rt-numeric-range');
});

test('a method\'s literal return is decided as a declaration\'s is', () => {
  refused('class K { m(): uint32 where return > 10 { return 5; } }', 'rt-return-contract');
});

test('a method call with a literal argument is decided as a function call is', () => {
  refused('class K { m(i: uint8) where i > 10 { return i; } } new K().m(5);', 'rt-where-unsatisfied');
  refused('const o = { m(i: uint8) where i > 10 { return i; } }; o.m(5);', 'rt-where-unsatisfied');
  refused('class K { static m(i: uint8) where i > 10 { return i; } } K.m(5);', 'rt-where-unsatisfied');
});

test('satisfiable clauses on these forms are unchanged', () => {
  expect(evaluated('class K { m(i: uint8) where i > 10 { return i; } } String(new K().m(11));')).toBe('11');
  expect(evaluated('const o = { m(i: uint8) where i > 10 { return i; } }; String(o.m(11));')).toBe('11');
  expect(evaluated('function* g(i: uint8) where i > 10 { yield i; } String(g(11).next().value);')).toBe('11');
});
