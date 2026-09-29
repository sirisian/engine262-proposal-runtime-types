import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("let scalar rest unused", () => {
  expectStaticTypeError("function f(x:any){let [...r:uint8]=x;}");
});

test("let scalar rest executed", () => {
  expectStaticTypeError("function f(x:any){let [...r:uint8]=x;}f([1]);");
});

test("const scalar rest unused", () => {
  expectStaticTypeError("function f(x:any){const [...r:uint8]=x;}");
});

test("const scalar rest executed", () => {
  expectStaticTypeError("function f(x:any){const [...r:uint8]=x;}f([1]);");
});

test("var scalar rest unused", () => {
  expectStaticTypeError("function f(x:any){var [...r:uint8]=x;}");
});

test("var scalar rest executed", () => {
  expectStaticTypeError("function f(x:any){var [...r:uint8]=x;}f([1]);");
});

test("empty rest unused", () => {
  expectStaticTypeError("function f(x:any){let [...r:uint8]=x;}");
});

test("empty rest executed", () => {
  expectStaticTypeError("function f(x:any){let [...r:uint8]=x;}f([]);");
});

test("known iterable unknown length unused", () => {
  expectStaticTypeError("function f(x:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}){let [...r:uint8]=x;}");
});

test("known iterable unknown length executed", () => {
  expectStaticTypeError("function f(x:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}){let [...r:uint8]=x;}f({[Symbol.iterator]:function*():Generator.<uint8,void,void>{yield uint8(1);}});");
});

test("scalar alias unused", () => {
  expectStaticTypeError("type Scalar=uint8;function f(x:any){let [...r:Scalar]=x;}");
});

test("scalar alias executed", () => {
  expectStaticTypeError("type Scalar=uint8;function f(x:any){let [...r:Scalar]=x;}f([1]);");
});

test("unconstrained type parameter unused", () => {
  expectStaticTypeError("function f<T: type>(x:any){let [...r:T]=x;}");
});

test("unconstrained type parameter executed", () => {
  expectStaticTypeError("function f<T: type>(x:any){let [...r:T]=x;}f.<uint8>([]);");
});

test("array rest annotated object currently accepted", () => {
  expectStaticTypeError("function f(x:any){let [...r:object]=x;}f([1]);");
});

test("array rest annotated any currently accepted", () => {
  expectStaticTypeError("function f(x:any){let [...r:any]=x;}f([1]);");
});

test("unannotated rest", () => {
  expect(ok("function f(x:any){let [...r]=x;}f([1]);")).toBe(true);
});

test("array rest valid", () => {
  expect(ok("function f(x:any){let [...r:[].<uint8>]=x;}f([1]);")).toBe(true);
});

test("tuple rest valid", () => {
  expect(ok("function f(x:any){let [...r:[uint8,string]]=x;}f([1,\"ok\"]);")).toBe(true);
});

test("fixed extent rest valid", () => {
  expect(ok("function f(x:any){let [...r:[2].<uint8>]=x;}f([1,2]);")).toBe(true);
});

test("array alias valid", () => {
  expect(ok("type A=[].<uint8>;function f(x:any){let [...r:A]=x;}f([1]);")).toBe(true);
});

test("array constrained type parameter", () => {
  expect(ok("function f<T: type extends [].<any>>(x:any){let [...r:T]=x;}f.<[].<uint8>>([1]);")).toBe(true);
});

test("unknown source still checks elements at runtime", () => {
  expectThrownKind("function f(x:any){let [...r:[].<uint8>]=x;}f([\"bad\"]);", "TypeError");
});

test("known literal already catches scalar", () => {
  expectStaticTypeError("function f(){let [...r:uint8]=[1];}");
});

test("formal rest already requires array", () => {
  expectStaticTypeError("function f(...r:uint8){}");
});

test("nested array rest annotation", () => {
  expectStaticTypeError("function f(x:any){let [...[...r:uint8]]=x;}");
});

test("nested rest parameter annotation", () => {
  expectStaticTypeError("function f(...[...r:uint8]){}");
});

test("arrow rest annotation", () => {
  expectStaticTypeError("const f=(...r:uint8)=>{};");
});

test("method rest annotation", () => {
  expectStaticTypeError("class C { f(...r:uint8){} }");
});

test("scalar constrained generic rest", () => {
  expectStaticTypeError("function f<T: type extends number>(x:any){let [...r:T]=x;}");
});

test("shadowed array alias resolves locally", () => {
  expectStaticTypeError("type R=[].<uint8>;function f(x:any){type R=uint8;let [...r:R]=x;}");
});

test("nested array rest preserves collected values", () => {
  expect(evaluated("function f(x:any){let [...[...r:[].<uint8>]]=x;return r;}const a:any=f([1,2]);String(a[0])+\",\"+String(a[1]);")).toBe("1,2");
});

test("object rest keeps object annotation", () => {
  expect(evaluated("function f(x:any){let {...r:object}=x;return r;}const a:any=f({x:1});String(a.x);")).toBe("1");
});

test("explicit dynamic element container", () => {
  expect(evaluated("function f(x:any){let [...r:[].<any>]=x;return r;}const a:any=f([1,\"two\"]);String(a[0])+\",\"+String(a[1]);")).toBe("1,two");
});

test("extent still checked at runtime for dynamic source", () => {
  expectThrownKind("function f(x:any){let [...r:[2].<uint8>]=x;}f([1]);", "TypeError");
});
