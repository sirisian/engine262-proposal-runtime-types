import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-named-arguments
test("rejects optional spread primitive", () => {
  expectStaticTypeError("function unused(f: () => void, x: uint8) {\n  f?.(...x);\n}");
});

test("rejects optional spread reached method", () => {
  expectStaticTypeError("function unused(o:{f:()=>void},x:uint8){o?.f(...x);}");
});

test("accepts optional spread any good", () => {
  expect(ok("function unused(f:(()=>void)|null,x:any){f?.(...x);}")).toBe(true);
});

test("accepts optional spread named good", () => {
  expect(ok("function unused(f:((x:uint8)=>void)|null){f?.(...{x:1});}")).toBe(true);
});

test("accepts optional spread good", () => {
  expect(ok("function unused(f:((x:uint8)=>void)|null,x:Iterable.<uint8>){f?.(...x);}")).toBe(true);
});

test("accepts optional spread null", () => {
  expect(ok("function unused(x:uint8){let f:null=null; f?.(...x);}")).toBe(true);
});

test("accepts optional spread string", () => {
  // A string is iterable; the parameter takes what it yields.
  expect(ok("function unused(f:((x:string)=>void)|null,x:string){f?.(...x);}")).toBe(true);
});
