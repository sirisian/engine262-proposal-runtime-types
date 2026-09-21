import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("R47: endpoint symbol unused", () => {
  expectStaticTypeError("function f(x:symbol){return x..<x;}");
});

test("R47: endpoint symbol executed", () => {
  expectStaticTypeError("function f(x:symbol){return x..<x;}f(Symbol());");
});

test("R47: endpoint null unused", () => {
  expectStaticTypeError("function f(x:null){return x..<x;}");
});

test("R47: endpoint null executed", () => {
  expectStaticTypeError("function f(x:null){return x..<x;}f(null);");
});

test("R47: endpoint undefined unused", () => {
  expectStaticTypeError("function f(x:undefined){return x..<x;}");
});

test("R47: endpoint undefined executed", () => {
  expectStaticTypeError("function f(x:undefined){return x..<x;}f(undefined);");
});

test("R47: endpoint null|undefined unused", () => {
  expectStaticTypeError("function f(x:null|undefined){return x..<x;}");
});

test("R47: endpoint null|undefined executed", () => {
  expectStaticTypeError("function f(x:null|undefined){return x..<x;}f(null);");
});

test("R47: endpoint symbol|null unused", () => {
  expectStaticTypeError("function f(x:symbol|null){return x..<x;}");
});

test("R47: endpoint symbol|null executed", () => {
  expectStaticTypeError("function f(x:symbol|null){return x..<x;}f(Symbol());");
});

test("R47: open start unused", () => {
  expectStaticTypeError("function f(x:symbol){return x..;}");
});

test("R47: open start executed", () => {
  expectStaticTypeError("function f(x:symbol){return x..;}f(Symbol());");
});

test("R47: open end unused", () => {
  expectStaticTypeError("function f(x:symbol){return ..=x;}");
});

test("R47: open end executed", () => {
  expectStaticTypeError("function f(x:symbol){return ..=x;}f(Symbol());");
});

test("R47: number", () => {
  expect(ok("function f(x:number){return x..<x;}f(1);")).toBe(true);
});

test("R47: bigint", () => {
  expect(ok("function f(x:bigint){return x..=x;}f(1n);")).toBe(true);
});

test("R47: sized integer", () => {
  expect(ok("function f(x:uint8){return x..<x;}f(1);")).toBe(true);
});

test("R47: infinite endpoint", () => {
  expect(ok("const r=0..<Infinity;")).toBe(true);
});

test("R47: ordered class", () => {
  expect(ok("class P{constructor(x:number){this.x=x;}operator<(other:P):boolean{return this.x<other.x;}}const r=new P(1)..<new P(3);")).toBe(true);
});

test("R47: unknown generic", () => {
  expect(ok("function f<T>(x:T){return x..<x;}")).toBe(true);
});

test("R47: object contract", () => {
  expect(ok("function f(x:object){return x..<x;}")).toBe(true);
});

test("R47: viable union", () => {
  expect(ok("function f(x:symbol|number){return x..<x;}f(1);")).toBe(true);
});

test("R47: empty range", () => {
  expect(ok("const r=..;")).toBe(true);
});

test("R47: any retains runtime", () => {
  expectThrownKind("function f(x:any){return x..<x;}f(Symbol());", 'TypeError');
});

test("R47: existing nested range exclusion", () => {
  expectStaticTypeError("function f(x:Range.<uint8>){return x..;}");
});

test("R47: literal alias", () => {
  expectStaticTypeError("type S=symbol;function f(x:S){return x..;}");
});

test("R47: omitted start differs from undefined", () => {
  expectStaticTypeError("function f(x:undefined){return ..=x;}");
});

test("R47: unknown union preserves check", () => {
  expect(ok("function f(x:symbol|object){return x..;}")).toBe(true);
});
