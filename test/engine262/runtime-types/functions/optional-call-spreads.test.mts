import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-call-argument-binding
test("rejects optional spread primitive", () => {
  expectStaticTypeError("function unused(f: () => void, x: uint8) {\n  f?.(...x);\n}");
});

test("rejects optional spread reached method", () => {
  expectStaticTypeError("function unused(o:{f:()=>void},x:uint8){o?.f(...x);}");
});

test("accepts optional spread any good", () => {
  expect(ok("function unused(f:()=>void,x:any){f?.(...x);}")).toBe(true);
});

test("accepts optional spread named good", () => {
  expect(ok("function f(x:uint8):void{} f?.(...{x:1});")).toBe(true);
});

test("accepts optional spread good", () => {
  expect(ok("function unused(f:(x:uint8)=>void,x:Iterable.<uint8>){f?.(...x);}")).toBe(true);
});

test("accepts optional spread null", () => {
  expect(ok("function unused(x:uint8){let f:null=null; f?.(...x);}")).toBe(true);
});

test("accepts optional spread string", () => {
  expect(ok("function unused(f:(x:uint8)=>void,x:string){f?.(...x);}")).toBe(true);
});
