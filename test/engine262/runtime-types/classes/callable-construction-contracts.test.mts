import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

// #sec-interfaces-semantics

test("callable interface obligation", () => {
  expectStaticTypeError("interface Callable { (value: uint8): uint8; }\nclass Claimed implements Callable {}");
});

test("callable interface method named call", () => {
  expectStaticTypeError("interface I{(x:uint8):uint8;}class C implements I{call(x:uint8):uint8{return x;}}");
});

test("class callable assignment", () => {
  expectStaticTypeError("interface I{(x:uint8):uint8;} class C implements I{} let i:I=new C();");
});

test("callable interface matching function", () => {
  expect(ok("interface I{(x:uint8):uint8;}const f:I=(x:uint8):uint8=>x;")).toBe(true);
});

test("callable interface function extends boundary", () => {
  expect(ok("interface I{(x:uint8):uint8;}class C extends Function implements I{}const f:any=new C(\"x\",\"return x\");let i:I=f;")).toBe(true);
});

test("callable interface constructor return boundary", () => {
  expect(ok("interface I{(x:uint8):uint8;}class C implements I{constructor(){return (x:uint8):uint8=>x;}}const f:any=new C();let i:I=f;")).toBe(true);
});

test("callable interface unknown heritage", () => {
  expect(ok("interface I{(x:uint8):uint8;}function unused(Base:any){class C extends Base implements I{}}")).toBe(true);
});

test("callable interface no implements", () => {
  expect(ok("interface I{(x:uint8):uint8;}class C{}")).toBe(true);
});

test("checks a known returned function contract", () => {
  expectStaticTypeError("interface I{(x:uint8):uint8;}class C implements I{constructor(){return (x:string):string=>x;}}");
});

test("follows inherited noncallable construction", () => {
  expectStaticTypeError("interface I{(x:uint8):uint8;}class B{}const A=B;class C extends A implements I{}");
});

test("defers a returned unknown object", () => {
  expect(ok("interface I{(x:uint8):uint8;}class C implements I{constructor(x:any){return x;}}")).toBe(true);
});
