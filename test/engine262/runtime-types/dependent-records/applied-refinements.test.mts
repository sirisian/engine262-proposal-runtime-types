import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-refinement-narrowing: a refinement applied to value arguments projects
 * its clauses with those arguments read as their constants, and
 * #sec-check-insertion: it decides a constant with its parameters bound to
 * them. A refinement applied to an open argument does neither.
 */
const LT = 'type Lt<N: uint8> = uint8 where this < N; ';
const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('an applied refinement projects into a clause sequence', () => {
  refused(`${LT}function f(x: Lt.<10>) where x > 100 { return x; }`, 'rt-impossible-test');
  refused(`${LT}type T = Lt.<10> where this > 100;`, 'rt-impossible-test');
  refused('type Between<A: uint8, B: uint8> = uint8 where this > A where this < B; function f(x: Between.<3, 9>) where x > 20 { return x; }', 'rt-impossible-test');
  expect(evaluated(`${LT}function f(x: Lt.<10>) where x > 5 { return x; } 'ok';`)).toBe('ok');
  expect(evaluated(`${LT}function f(x: Lt.<200>) where x > 100 { return x; } 'ok';`)).toBe('ok');
});

test('an applied refinement decides a constant where it is written', () => {
  refused(`${LT}let v: Lt.<10> = 20;`, 'rt-assignability');
  refused(`${LT}function f(x: Lt.<10>) { return x; } f(20);`, 'rt-assignability');
  refused(`${LT}function f(): Lt.<10> { return 20; }`, 'rt-assignability');
  expect(evaluated(`${LT}let v: Lt.<10> = 5; String(v);`)).toBe('5');
});

test('an open argument leaves both to each application', () => {
  expect(evaluated(`${LT}function f<M: uint8>(x: Lt.<M>) where x > 100 { return x; } 'ok';`)).toBe('ok');
  expect(evaluated(`${LT}function f<M: uint8>(x: Lt.<M>) { return x; } String(f.<10>(5));`)).toBe('5');
});
