import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-reference-parameters with #sec-type-errors. A `ref` parameter is
 * bound to the caller's LOCATION and written through, so the call has to name
 * one. Whether the call writes `ref` is syntax and whether the parameter
 * declares it is syntax, so neither operand's VALUE is involved - and the run
 * time reported "parameter a requires a ref argument" only when the call ran.
 *
 * Every case is inside a function that is never called.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a ref parameter requires a ref argument', () => {
  expectThrown(dead('function f(ref a: uint8) { } let n: uint8 = uint8(1); f(n);'),
    'requires a ref argument');
  expectThrown(dead('function f(ref a) { } let n = 1; f(n);'), 'requires a ref argument');
  // The second parameter is the one that declares it.
  expectThrown(dead('function f(a: uint8, ref b: uint8) { } let n: uint8 = uint8(1); f(n, n);'),
    'requires a ref argument');
  // A method declares it the same way.
  expectThrown(dead('class C { m(ref a: uint8) { } } let n: uint8 = uint8(1); new C().m(n);'),
    'requires a ref argument');
});

test('the DECAY direction is specified behaviour, not a mistake', () => {
  // A ref argument to a parameter that declares none decays to its value: the
  // callee gets the value and cannot write through, and the caller is
  // unchanged. Refusing it would refuse a program the language defines.
  expect(ok(dead('function f(a: uint8) { } let n: uint8 = uint8(1); f(ref n);'))).toBe(true);
  expect(ok('let x = 1; function id(v) { v = 9; return v; } let r = id(ref x);'
    + ' String(x) + "," + String(r);')).toBe(true);
});

test('what the rule does not reach', () => {
  // The ordinary call, at every location kind a ref argument may name.
  expect(ok(dead('function f(ref a: uint8) { } let n: uint8 = uint8(1); f(ref n);'))).toBe(true);
  expect(ok(dead('function f(ref a) { a++; } let a = 0; f(ref a);'))).toBe(true);
  expect(ok(dead('const o = { a: 0 }; function f(ref a) { a++; } f(ref o.a);'))).toBe(true);
  expect(ok(dead('let arr = [41]; function f(ref a) { a++; } f(ref arr[0]);'))).toBe(true);

  // A SPREAD suspends the positional mapping, and so does a REST parameter,
  // for the reason the missing-argument rule stands down on both.
  expect(ok(dead('function f(ref a: uint8) { } let r: [].<uint8> = []; f(...r);'))).toBe(true);
  expect(ok(dead('function f(...r: [].<uint8>) { } let n: uint8 = uint8(1); f(n);'))).toBe(true);

  // An untyped callee is not judged.
  expect(ok(dead('let g: any = (x) => x; let n: uint8 = uint8(1); let q = g(n);'))).toBe(true);
});
