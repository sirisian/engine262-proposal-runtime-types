import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a method signature in an interface or an object type,
 * and an abstract method, may state clauses over its parameters; they are the
 * contract every implementer inherits, judged at the signature, and an
 * implementer may only repeat or weaken them.
 */

const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('a signature clause may read the signature\'s parameters', () => {
  expect(evaluated("interface I { m(x: uint8): void where x > 10; } 'ok';")).toBe('ok');
  expect(evaluated("type O = { m(x: uint8): void where x > 10 }; 'ok';")).toBe('ok');
});

test('a signature clause that can never hold is refused at the signature', () => {
  refused('interface I { m(x: uint8): void where x > 300; }', 'rt-numeric-range');
  refused('abstract class A { abstract m(x: uint8): void where x > 300; }', 'rt-numeric-range');
  refused('interface J { m(x: uint8): uint8 where return > 300; }', 'rt-numeric-range');
  refused('interface K { m<N: uint8>(): void where N > 300; }', 'rt-numeric-range');
});

test('an implementer may weaken an inherited clause over a parameter, never strengthen it', () => {
  expect(evaluated("interface I { m(x: uint8): void where x > 10; } class C implements I { m(x: uint8): void where x > 5 {} } 'ok';")).toBe('ok');
  refused('interface I { m(x: uint8): void where x > 10; } class C implements I { m(x: uint8): void where x > 20 {} }', 'rt-implements-contract');
});

// #sec-generic-where: a signature's clauses are judged where it is declared,
// under the generic parameters of the interface or object type that declares
// it, as a method's are under its class's. An operator member's signature is
// one of them.
const signatureRefused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('an interface\'s value parameter is a subject of its signatures\' clauses', () => {
  signatureRefused('interface I<N: uint8> { m(): void where N > 300; }', 'rt-numeric-range');
  signatureRefused('interface I<N: uint8> { m(): void where N > 5 where N < 3; }', 'rt-impossible-test');
  signatureRefused('interface I<N: uint8> { x: [N].<uint8>; m(): void where N > 300; }', 'rt-numeric-range');
  expect(observeScript("interface I<N: uint8> { m(): void where N > 5; } 'ok';")).toMatchObject({ completion: { Type: 'normal' } });
});

test('a generic object type\'s value parameter is one too', () => {
  signatureRefused('type O<N: uint8> = { m(): void where N > 5 where N < 3 };', 'rt-impossible-test');
});

test('an interface\'s operator signature has its clauses judged', () => {
  signatureRefused('interface I { operator+(r: uint8): uint8 where r > 300; }', 'rt-numeric-range');
  signatureRefused('interface I { operator+(r: uint8): uint8 where r > 5 where r < 3; }', 'rt-impossible-test');
  expect(observeScript("interface I { operator+(r: uint8): uint8 where r > 5; } 'ok';")).toMatchObject({ completion: { Type: 'normal' } });
});
