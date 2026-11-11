import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-where-clauses: an intersection of refinements of one base admits the
 * values every one of them admits. Two refinements written in source that
 * leave some place no value are a contradiction written in source, refused
 * where the intersection is written; a constant crosses into the
 * intersection by satisfying each; and a clause reads a subject of that
 * type through every member's clauses.
 */
const AB = 'type A = uint8 where this < 10; type B = uint8 where this > 100; ';
const AC = 'type A = uint8 where this < 10; type C = uint8 where this < 50; ';
const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('two refinements that share no value are refused where they intersect', () => {
  refused(`${AB}type E = A & B;`, 'rt-empty-intersection');
  refused(`${AB}function f(x: A & B) {}`, 'rt-empty-intersection');
  refused(`${AB}function f<T: type extends A & B>(v: T) {}`, 'rt-empty-intersection');
  refused('type A = uint8 where this < 10; type B = uint8 where this >= 10; type E = A & B;', 'rt-empty-intersection');
});

test('record and length refinements are judged the same way', () => {
  refused('type RA = { n: uint8 } where this.n < 10; type RB = { n: uint8 } where this.n > 100; type RE = RA & RB;', 'rt-empty-intersection');
  refused('type SA = string where this.length < 3; type SB = string where this.length > 5; type SE = SA & SB;', 'rt-empty-intersection');
});

test('a refinement against a literal type is refused as before', () => {
  refused('type A = uint8 where this < 10; type E = A & 20;', 'rt-empty-intersection');
});

test('an intersection that has values admits a constant that satisfies every member', () => {
  expect(evaluated(`${AC}let x: A & C = 5; String(x);`)).toBe('5');
  expect(evaluated(`${AC}type E = A & C; let x: E = 5; String(x);`)).toBe('5');
  expect(evaluated(`${AC}function f(x: A & C) { return x; } String(f(5));`)).toBe('5');
  expect(evaluated('type RA = { n: uint8 } where this.n < 10; type RC = { n: uint8 } where this.n < 50; const v: RA & RC = { n: 5 }; String(v.n);')).toBe('5');
});

test('a constant that fails a member is refused where it is written', () => {
  refused(`${AC}let x: A & C = 20;`, 'rt-assignability');
  refused(`${AC}type E = A & C; let x: E = 20;`, 'rt-assignability');
  refused(`${AC}function f(x: A & C) { return x; } f(20);`, 'rt-assignability');
  refused('type RA = { n: uint8 } where this.n < 10; type RC = { n: uint8 } where this.n < 50; const v: RA & RC = { n: 20 };', 'rt-assignability');
});

test('the run time checks every member', () => {
  expect(evaluated(`${AC}function f(v: uint8) { return v is (A & C); } String(f(5)) + String(f(20)) + String(f(60));`)).toBe('truefalsefalse');
});

test('a clause reads a subject through every member', () => {
  refused(`${AC}function f(x: A & C) where x > 20 { return x; }`, 'rt-impossible-test');
  refused(`${AC}type E = A & C; function f(x: E) where x > 20 { return x; }`, 'rt-impossible-test');
  expect(evaluated(`${AC}type E = A & C; function f(x: E) where x > 5 { return x; } 'ok';`)).toBe('ok');
});

test('a value of the intersection is a value of each member', () => {
  expect(evaluated(`${AC}function f(x: A & C): A { return x; } 'ok';`)).toBe('ok');
});

test('a test in a body writes no intersection and is not judged', () => {
  expect(evaluated(`${AB}function f(v: A) { if (v is B) {} } 'ok';`)).toBe('ok');
});
