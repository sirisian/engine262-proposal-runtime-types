import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-type-parameters
test("rejects generic bound write", () => {
  expectStaticTypeError("function unused<T: type extends { x: uint8 }>(o: T) {\n  o.x = \"s\";\n}");
});

test("rejects function constraint read bad", () => {
  expectStaticTypeError("function unused<T: type extends { x: uint8 }>(o: T) { let s: string = o.x; }");
});

test("rejects function constraint call bad", () => {
  expectStaticTypeError("function unused<T: type extends (x: uint8) => void>(f: T) { f(\"s\"); }");
});

test("rejects generic shape nested bad", () => {
  expectStaticTypeError("function unused<T: type extends {x:{y:uint8}}>(o:T){let s:string=o.x.y;}");
});

test("rejects function constraint builtin bad", () => {
  expectStaticTypeError("function unused<T: type extends [].<uint8>>(a:T){a[0]=\"s\";}");
});

test("rejects function constraint operator bad", () => {
  expectStaticTypeError("function unused<T: type extends uint8>(x:T){const s:string=x+1;}");
});

test("rejects generic bound readonly", () => {
  expectStaticTypeError("function f<T:type extends {readonly x:uint8}>(o:T){o.x=1;}");
});

test("rejects generic bound opacity", () => {
  expectStaticTypeError("function f<T:type extends {x:uint8}>(o:T){const x:T={x:1};}");
});

test("accepts generic bound good", () => {
  expect(ok("function f<T:type extends {x:uint8}>(o:T){const x:uint8=o.x;}")).toBe(true);
});

test("accepts generic bound unbounded good", () => {
  expect(ok("function unused<T:type>(o:T){o.x=\"s\";}")).toBe(true);
});

test("accepts generic bound any good", () => {
  expect(ok("function unused<T:type extends {x:any}>(o:T){o.x=\"s\";}")).toBe(true);
});

test("accepts generic bound callable good", () => {
  expect(ok("function unused<T:type extends (x:uint8)=>void>(f:T){f(1);}")).toBe(true);
});

test("bound reference invariance", () => {
  expectStaticTypeError("function take(ref x:{x:uint8}){}function unused<T:type extends {x:uint8}>(o:T){take(ref o);}");
});

test("bound union read", () => {
  expectStaticTypeError("function unused<T:type extends {x:uint8}|{x:string}>(o:T){let s:boolean=o.x;}");
});

test("bound self assignment", () => {
  expect(ok("function unused<T:type extends {x:uint8}>(o:T){let x:T=o;}")).toBe(true);
});

test("bound array read", () => {
  expectStaticTypeError("function unused<T:type extends [].<uint8>>(a:T){const s:string=a[0];}");
});

test("bound call return", () => {
  expectStaticTypeError("function unused<T:type extends ()=>uint8>(f:T){const s:string=f();}");
});

test("bound array good", () => {
  expect(ok("function unused<T:type extends [].<uint8>>(a:T){const n:uint8=a[0];}")).toBe(true);
});
