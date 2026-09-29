import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { X } from '#self';

// #sec-typed-destructuring

test("rejects function f({(x: uint8)}) {} f({x: \"s\"});", () => {
  expectStaticTypeError("function f({(x: uint8)}) {} f({x: \"s\"});");
});

test("rejects function f({(x: uint8)}) {} f({});", () => {
  expectStaticTypeError("function f({(x: uint8)}) {} f({});");
});

test("rejects function f([x: uint8]) {} f(Composite.<[string]>([\"s\"]));", () => {
  expectStaticTypeError("function f([x: uint8]) {} f(Composite.<[string]>([\"s\"]));");
});

test("rejects function f(...[x: uint8, y: string]) {} f(\"s\", 1);", () => {
  expectStaticTypeError("function f(...[x: uint8, y: string]) {} f(\"s\", 1);");
});

test("rejects function f({(x: uint8)} = {x: \"s\"}) {} f();", () => {
  expectStaticTypeError("function f({(x: uint8)} = {x: \"s\"}) {} f();");
});

test("rejects function f({(x: uint8)}) {} const n: null = null; f(n);", () => {
  expectStaticTypeError("function f({(x: uint8)}) {} const n: null = null; f(n);");
});

test("rejects const {(x: uint8)} = {x: \"s\"};", () => {
  expectStaticTypeError("const {(x: uint8)} = {x: \"s\"};");
});

test("rejects function f({(x: uint8)}: {x: string}) {}", () => {
  expectStaticTypeError("function f({(x: uint8)}: {x: string}) {}");
});

test("rejects function f({(x: uint8)} = {x: \"s\"}) {}", () => {
  expectStaticTypeError("function f({(x: uint8)} = {x: \"s\"}) {}");
});

test("accepts function f({(x: uint8)}) { return x; } f({x: 1});", () => {
  expect(ok("function f({(x: uint8)}) { return x; } f({x: 1});")).toBe(true);
});

test("accepts function f({(x: uint8)}) {} function g(v: any) { f(v); }", () => {
  expect(ok("function f({(x: uint8)}) {} function g(v: any) { f(v); }")).toBe(true);
});

test("accepts Array.prototype[Symbol.iterator] = function* () { yield 1; }; function f([x: uint8]) { return x", () => {
  expect(ok("Array.prototype[Symbol.iterator] = function* () { yield 1; }; function f([x: uint8]) { return x; } f([\"s\"]);")).toBe(true);
});


test('specialization substitutes nested formal annotations', () => {
  expectStaticTypeError('function f<T:type>({(x:T)}){} f.<uint8>({x:"s"});');
  expect(ok('function f<T:type>({(x:T)}){} f.<string>({x:"s"});')).toBe(true);
});

test('a nested contract keeps its declaration alias environment', () => {
  expectStaticTypeError('type X=uint8; function f({(x:X)}){} {type X=string; f({x:"s"});}');
});

test('formal rests check the collected object and array', () => {
  expectStaticTypeError('function f({...r:{x:uint8}}){} f({x:"s"});');
  expectStaticTypeError('function f([...[x:uint8]]){} f(["s"]);');
  expect(ok('function f({...r:{x:uint8}}){} f({x:1});')).toBe(true);
  expect(ok('function f([...[x:uint8]]){} f([1]);')).toBe(true);
});

test.each([
  'function f({x:{(y:uint8)}}){} f({x:{y:"s"}});',
  'function f({(x:uint8):y}){} f({x:"s"});',
  'function f({(x:uint8)},y:string){} f({x:"s"},y:"ok");',
  'function f({(ref x:uint8)}){} f({(x:string):"s"});',
])('retains the nested binding boundary: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  'function f({(ref x:uint8)}){} f({(x:uint8):1});',
  'function f({(x?:uint8)}){} f({});',
  'function f({(x:uint8)=1}){} f({});',
  'function f({(x:uint8)}){} f(...[{x:1}]);',
])('preserves binding and mapping rules: %s', (source) => {
  expect(ok(source)).toBe(true);
});
