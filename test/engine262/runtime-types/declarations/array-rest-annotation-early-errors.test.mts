import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("R54: let scalar rest unused", () => {
  expectStaticTypeError("function f(x:any){let [...r:uint8]=x;}");
});

test("R54: let scalar rest executed", () => {
  expectStaticTypeError("function f(x:any){let [...r:uint8]=x;}f([1]);");
});

test("R54: const scalar rest unused", () => {
  expectStaticTypeError("function f(x:any){const [...r:uint8]=x;}");
});

test("R54: const scalar rest executed", () => {
  expectStaticTypeError("function f(x:any){const [...r:uint8]=x;}f([1]);");
});

test("R54: var scalar rest unused", () => {
  expectStaticTypeError("function f(x:any){var [...r:uint8]=x;}");
});

test("R54: var scalar rest executed", () => {
  expectStaticTypeError("function f(x:any){var [...r:uint8]=x;}f([1]);");
});

test("R54: empty rest unused", () => {
  expectStaticTypeError("function f(x:any){let [...r:uint8]=x;}");
});

test("R54: empty rest executed", () => {
  expectStaticTypeError("function f(x:any){let [...r:uint8]=x;}f([]);");
});

test("R54: known iterable unknown length unused", () => {
  expectStaticTypeError("function f(x:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}){let [...r:uint8]=x;}");
});

test("R54: known iterable unknown length executed", () => {
  expectStaticTypeError("function f(x:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}){let [...r:uint8]=x;}f({[Symbol.iterator]:function*():Generator.<uint8,void,void>{yield uint8(1);}});");
});

test("R54: scalar alias unused", () => {
  expectStaticTypeError("type Scalar=uint8;function f(x:any){let [...r:Scalar]=x;}");
});

test("R54: scalar alias executed", () => {
  expectStaticTypeError("type Scalar=uint8;function f(x:any){let [...r:Scalar]=x;}f([1]);");
});

test("R54: unconstrained type parameter unused", () => {
  expectStaticTypeError("function f<T>(x:any){let [...r:T]=x;}");
});

test("R54: unconstrained type parameter executed", () => {
  expectStaticTypeError("function f<T>(x:any){let [...r:T]=x;}f.<uint8>([]);");
});

test("R54: array rest annotated object currently accepted", () => {
  expectStaticTypeError("function f(x:any){let [...r:object]=x;}f([1]);");
});

test("R54: array rest annotated any currently accepted", () => {
  expectStaticTypeError("function f(x:any){let [...r:any]=x;}f([1]);");
});

test("R54: unannotated rest", () => {
  expect(ok("function f(x:any){let [...r]=x;}f([1]);")).toBe(true);
});

test("R54: array rest valid", () => {
  expect(ok("function f(x:any){let [...r:[].<uint8>]=x;}f([1]);")).toBe(true);
});

test("R54: tuple rest valid", () => {
  expect(ok("function f(x:any){let [...r:[uint8,string]]=x;}f([1,\"ok\"]);")).toBe(true);
});

test("R54: fixed extent rest valid", () => {
  expect(ok("function f(x:any){let [...r:[2].<uint8>]=x;}f([1,2]);")).toBe(true);
});

test("R54: array alias valid", () => {
  expect(ok("type A=[].<uint8>;function f(x:any){let [...r:A]=x;}f([1]);")).toBe(true);
});

test("R54: array constrained type parameter", () => {
  expect(ok("function f<T extends [].<any>>(x:any){let [...r:T]=x;}f.<[].<uint8>>([1]);")).toBe(true);
});

test("R54: unknown source still checks elements at runtime", () => {
  expectThrownKind("function f(x:any){let [...r:[].<uint8>]=x;}f([\"bad\"]);", "TypeError");
});

test("R54: known literal already catches scalar", () => {
  expectStaticTypeError("function f(){let [...r:uint8]=[1];}");
});

test("R54: formal rest already requires array", () => {
  expectStaticTypeError("function f(...r:uint8){}");
});

test("R54: nested array rest annotation", () => {
  expectStaticTypeError("function f(x:any){let [...[...r:uint8]]=x;}");
});

test("R54: nested rest parameter annotation", () => {
  expectStaticTypeError("function f(...[...r:uint8]){}");
});

test("R54: arrow rest annotation", () => {
  expectStaticTypeError("const f=(...r:uint8)=>{};");
});

test("R54: method rest annotation", () => {
  expectStaticTypeError("class C { f(...r:uint8){} }");
});

test("R54: scalar constrained generic rest", () => {
  expectStaticTypeError("function f<T extends number>(x:any){let [...r:T]=x;}");
});

test("R54: shadowed array alias resolves locally", () => {
  expectStaticTypeError("type R=[].<uint8>;function f(x:any){type R=uint8;let [...r:R]=x;}");
});

test("R54: nested array rest preserves collected values", () => {
  expect(evaluated("function f(x:any){let [...[...r:[].<uint8>]]=x;return r;}const a:any=f([1,2]);String(a[0])+\",\"+String(a[1]);")).toBe("1,2");
});

test("R54: object rest keeps object annotation", () => {
  expect(evaluated("function f(x:any){let {...r:object}=x;return r;}const a:any=f({x:1});String(a.x);")).toBe("1");
});

test("R54: explicit dynamic element container", () => {
  expect(evaluated("function f(x:any){let [...r:[].<any>]=x;return r;}const a:any=f([1,\"two\"]);String(a[0])+\",\"+String(a[1]);")).toBe("1,two");
});

test("R54: extent still checked at runtime for dynamic source", () => {
  expectThrownKind("function f(x:any){let [...r:[2].<uint8>]=x;}f([1]);", "TypeError");
});
