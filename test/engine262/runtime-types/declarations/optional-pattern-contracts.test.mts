import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

// #sec-typed-destructuring

test("optional pattern read", () => {
  expectStaticTypeError("function unused(source: any) {\n  const { (x?: uint8) } = source;\n  let value: uint8 = x;\n}");
});

test("optional pattern present bad", () => {
  expectStaticTypeError("const {(x?:uint8)}={x:\"s\"};");
});

test("optional pattern ordinary param control", () => {
  expectStaticTypeError("function unused(x?:uint8){let n:uint8=x;}");
});

test("optional pattern typed", () => {
  expectStaticTypeError("function unused(o:{x?:uint8}){const {(x?:uint8)}=o;let n:uint8=x;}");
});

test("optional pattern renamed", () => {
  expectStaticTypeError("function unused(o:any){const {(x?:uint8):y}=o;let n:uint8=y;}");
});

test("optional pattern guard", () => {
  expect(ok("function unused(o:any){const {(x?:uint8)}=o;if(x!==undefined){let n:uint8=x;}}")).toBe(true);
});

test("optional pattern default", () => {
  expect(ok("function unused(o:any){const {(x?:uint8)=1}=o;let n:uint8=x;}")).toBe(true);
});

test("optional pattern absent valid", () => {
  expect(ok("function unused(o:any){const {(x?:uint8)}=o;let n:uint8|undefined=x;}unused({});")).toBe(true);
});

test("optional pattern known absent valid", () => {
  expect(ok("const {(x?:uint8)}={};")).toBe(true);
});

test("optional pattern good", () => {
  expect(ok("function unused(o:any){const {(x?:uint8)}=o;let n:uint8|undefined=x;}")).toBe(true);
});

test("optional pattern present undefined", () => {
  expect(ok("function unused(o:any){const {(x?:uint8)}=o;globalThis.__observation=String(x);}unused({x:undefined});")).toBe(true);
});

test("nonoptional pattern guard", () => {
  expect(ok("function unused(o:any){const {(x:uint8)}=o;let n:uint8=x;}")).toBe(true);
});

test("preserves undefined supplied by an optional default", () => {
  expect(ok("function f(o:any){const {(x?:uint8)=undefined}=o;let n:uint8|undefined=x;}")).toBe(true);
});

test("keeps explicitly present undefined optional", () => {
  expect(evaluated("function f(o:any){const {(x?:uint8)}=o;return String(x);}f({x:undefined});")).toBe("undefined");
});

test("adopts a numeric optional default", () => {
  expect(evaluated("function f(o:any){const {(x?:uint8)=1}=o;return String(Reflect.typeOf(x));}f({});")).toBe("uint.<8>");
});

test("checks a renamed optional default", () => {
  expectStaticTypeError("function f(o:any){const {(x?:uint8):y=\"bad\"}=o;}");
});
