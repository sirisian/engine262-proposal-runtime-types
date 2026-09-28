import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

// #sec-type-annotations

test("destructured rest contract", () => {
  expectStaticTypeError("function unused(...{ 0: x }: [uint8]) {\n  let text: string = x;\n}");
});

test("rest object direct control", () => {
  expectStaticTypeError("function unused({0:x}:[uint8]){let s:string=x;}");
});

test("rest object named control", () => {
  expectStaticTypeError("function unused(...xs:[uint8]){let s:string=xs[0];}");
});

test("rest object missing argument", () => {
  expectStaticTypeError("function unused(...{0:x}:[uint8]){}unused();");
});

test("rest object explicit member", () => {
  expectStaticTypeError("function unused(...{0:x:uint8}:[uint8]){let s:string=x;}");
});

test("rest object tuple good", () => {
  expect(ok("function unused(...{0:x}:[uint8]){let s:uint8=x;}")).toBe(true);
});

test("rest object tuple any", () => {
  expect(ok("function unused(...{0:x}:[any]){let s:string=x;}")).toBe(true);
});

test("converts collected tuple elements before an object pattern", () => {
  expect(evaluated("function f(...{0:x}:[uint8]){return String(Reflect.typeOf(x));}f(1);")).toBe("uint.<8>");
});

test("enforces erased calls to a patterned rest", () => {
  expect(evaluated("function f(...{0:x}:[uint8]){}const erased:any=f;try{erased(\"bad\");}catch(e){e.constructor.name;}")).toBe("TypeError");
});

test("checks rest pattern names in arrows", () => {
  expectStaticTypeError("const f=(...{0:x}:[uint8])=>{let s:string=x;};");
});

test("does not infer an array pattern from replaceable indexed storage", () => {
  expect(ok("function f(...[x]:[].<uint8>){let s:string=x;}")).toBe(true);
});
