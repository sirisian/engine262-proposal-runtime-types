import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowing-flow: a constant index into a position the value's type
 * fixes is a path, so a fact about it is carried from one clause to the next
 * as a fact about a member is. A tuple's declared positions and a fixed
 * array's elements are such positions; a tuple's rest and a dynamic array's
 * elements are not.
 */
const neverSucceeds = (source: string): void => {
  const observed = observeScript(source);
  expect(observed).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
};
const accepted = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ completion: { Type: 'normal' } });
};

test('a tuple position is narrowed by a clause sequence', () => {
  neverSucceeds('function f(t: [uint8, uint8]) where t[0] > 5 where t[0] < 3 { return t; }');
  neverSucceeds('function f(t: [uint8, string]) where t[0] > 5 where t[0] < 3 { return t; }');
  accepted('function f(t: [uint8, uint8]) where t[0] > 5 where t[1] < 3 { return t; }');
  expect(evaluated('function f(t: [uint8, uint8]) where t[0] > 5 where t[0] < 9 { return t[0]; } const v: [uint8, uint8] = [7, 1]; String(f(v));')).toBe('7');
});

test('two positions of one tuple keep an order relation', () => {
  neverSucceeds('function f(t: [uint8, uint8]) where t[0] < t[1] where t[1] < t[0] { return t; }');
  accepted('function f(t: [uint8, uint8]) where t[0] < t[1] where t[1] > 3 { return t; }');
});

test('a position is a path through this, through a member and through return', () => {
  neverSucceeds('type P = [uint8, uint8] where this[0] > 5 where this[0] < 3;');
  neverSucceeds('type R = { t: [uint8, uint8] } where this.t[0] > 5 where this.t[0] < 3;');
  neverSucceeds('function f(t: [uint8, uint8]): [uint8, uint8] where return[0] > 5 where return[0] < 3 { return t; }');
});

test('a fixed array element and a record member are narrowed as before', () => {
  neverSucceeds('function f(a: [4].<uint8>) where a[1] > 5 where a[1] < 3 { return a; }');
  neverSucceeds('function f(p: { x: uint8, y: uint8 }) where p.x < p.y where p.y < p.x { return p; }');
});

test('a position the type does not fix is not a place', () => {
  // A dynamic array's extent can change under an index.
  accepted('function f(a: [].<uint8>) where a[1] > 5 where a[1] < 3 { return a; }');
  // A tuple's rest holds any number of elements.
  accepted('function f(t: [uint8, ...[].<uint8>]) where t[1] > 5 where t[1] < 3 { return t; }');
});

test('a position outside the tuple is still an error of its own', () => {
  expect(observeScript('function f(t: [uint8, uint8]) where t[2] > 5 { return t; }'))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-index-signature' } });
});
