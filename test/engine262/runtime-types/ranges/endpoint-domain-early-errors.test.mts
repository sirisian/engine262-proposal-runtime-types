import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("endpoint symbol unused", () => {
  expectStaticTypeError("function f(x:symbol){return x..<x;}");
});

test("endpoint symbol executed", () => {
  expectStaticTypeError("function f(x:symbol){return x..<x;}f(Symbol());");
});

test("endpoint null unused", () => {
  expectStaticTypeError("function f(x:null){return x..<x;}");
});

test("endpoint null executed", () => {
  expectStaticTypeError("function f(x:null){return x..<x;}f(null);");
});

test("endpoint undefined unused", () => {
  expectStaticTypeError("function f(x:undefined){return x..<x;}");
});

test("endpoint undefined executed", () => {
  expectStaticTypeError("function f(x:undefined){return x..<x;}f(undefined);");
});

test("endpoint null|undefined unused", () => {
  expectStaticTypeError("function f(x:null|undefined){return x..<x;}");
});

test("endpoint null|undefined executed", () => {
  expectStaticTypeError("function f(x:null|undefined){return x..<x;}f(null);");
});

test("endpoint symbol|null unused", () => {
  expectStaticTypeError("function f(x:symbol|null){return x..<x;}");
});

test("endpoint symbol|null executed", () => {
  expectStaticTypeError("function f(x:symbol|null){return x..<x;}f(Symbol());");
});

test("open start unused", () => {
  expectStaticTypeError("function f(x:symbol){return x..;}");
});

test("open start executed", () => {
  expectStaticTypeError("function f(x:symbol){return x..;}f(Symbol());");
});

test("open end unused", () => {
  expectStaticTypeError("function f(x:symbol){return ..=x;}");
});

test("open end executed", () => {
  expectStaticTypeError("function f(x:symbol){return ..=x;}f(Symbol());");
});

test("number", () => {
  expect(ok("function f(x:number){return x..<x;}f(1);")).toBe(true);
});

test("bigint", () => {
  expect(ok("function f(x:bigint){return x..=x;}f(1n);")).toBe(true);
});

test("sized integer", () => {
  expect(ok("function f(x:uint8){return x..<x;}f(1);")).toBe(true);
});

test("infinite endpoint", () => {
  expect(ok("const r=0..<Infinity;")).toBe(true);
});

test("ordered class", () => {
  expect(ok("class P{constructor(x:number){this.x=x;}operator<(other:P):boolean{return this.x<other.x;}}const r=new P(1)..<new P(3);")).toBe(true);
});

test("unknown generic", () => {
  expect(ok("function f<T: type>(x:T){return x..<x;}")).toBe(true);
});

test("object contract", () => {
  expect(ok("function f(x:object){return x..<x;}")).toBe(true);
});

test("viable union", () => {
  expect(ok("function f(x:symbol|number){return x..<x;}f(1);")).toBe(true);
});

test("empty range", () => {
  expect(ok("const r=..;")).toBe(true);
});

test("any retains runtime", () => {
  expectThrownKind("function f(x:any){return x..<x;}f(Symbol());", 'TypeError');
});

test("existing nested range exclusion", () => {
  expectStaticTypeError("function f(x:Range.<uint8>){return x..;}");
});

test("literal alias", () => {
  expectStaticTypeError("type S=symbol;function f(x:S){return x..;}");
});

test("omitted start differs from undefined", () => {
  expectStaticTypeError("function f(x:undefined){return ..=x;}");
});

test("unknown union preserves check", () => {
  expect(ok("function f(x:symbol|object){return x..;}")).toBe(true);
});
