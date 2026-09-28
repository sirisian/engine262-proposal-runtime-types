import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

// #sec-static-iteration-contribution

test("structural pattern store", () => {
  expectStaticTypeError("function unused(source: Iterable.<string>) {\n  let value: uint8 = 0;\n  [value] = source;\n}");
});

test("destructure structural custom", () => {
  expectStaticTypeError("function unused(xs:{[Symbol.iterator]:()=>{next:()=>{done:false,value:string}}}){let n:uint8=0;[n]=xs;}");
});

test("destructure structural rest", () => {
  expectStaticTypeError("function unused(xs:Iterable.<string>){let n:[].<uint8>=[];[...n]=xs;}");
});

test("destructure forof control", () => {
  expectStaticTypeError("function unused(xs:Iterable.<string>){let n:uint8=0;for(n of xs){}}");
});

test("destructure iterator const", () => {
  expectStaticTypeError("function f(xs: Iterable.<string>) { const [n]=xs; let v:uint8=n; }");
});

test("destructure annotated iterator bad", () => {
  expectStaticTypeError("function f(xs: Iterable.<string>) { let [n:uint8]=xs; }");
});

test("destructure structural good", () => {
  expect(ok("function unused(xs:Iterable.<uint8>){let n:uint8=0;[n]=xs;}")).toBe(true);
});

test("destructure structural any", () => {
  expect(ok("function unused(xs:Iterable.<any>){let n:uint8=0;[n]=xs;}")).toBe(true);
});

test("checks a typed fresh array contribution", () => {
  expectStaticTypeError("let n:uint8=0;[n]=[\"bad\"];");
});

test("keeps fresh array numeric literal context", () => {
  expect(ok("let [n:uint8]=[1];")).toBe(true);
});

test("defers replaceable array iteration", () => {
  expect(ok("function f(xs:[].<string>){let [n:uint8]=xs;}")).toBe(true);
});

test("retains readonly reference permissions", () => {
  expectStaticTypeError("class C{readonly n:uint8=0;f(xs:Iterable.<uint8>){const ref p=this.n;[p]=xs;}}");
});


test('preserves immutable tuple positions at annotated destinations', () => {
  expect(ok('function f(xs:Composite.<[uint8,string]>){let [n:uint8,s:string]=xs;}')).toBe(true);
});

test('preserves immutable tuple rest positions', () => {
  expect(ok('function f(xs:Composite.<[uint8,string]>){let [...pair:[uint8,string]]=xs;}')).toBe(true);
});
