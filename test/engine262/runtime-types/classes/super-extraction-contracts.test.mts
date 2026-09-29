import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-static-type-of-an-expression

test("super const contract", () => {
  expectStaticTypeError("class Base { get value(): uint8 { return 1; } }\nclass Derived extends Base {\n  read() {\n    const value = super.value;\n    let text: string = value;\n  }\n}");
});

test("super extract computed", () => {
  expectStaticTypeError("class B{get x():uint8{return 1;}}class C extends B{f(){const x=super[\"x\"];let n:string=x;}}");
});

test("super extract annotated control", () => {
  expectStaticTypeError("class B{get x():uint8{return 1;}}class C extends B{f(){const x:uint8=super.x;let n:string=x;}}");
});

test("super extraction call runtime", () => {
  expectStaticTypeError("class B {m(x:uint8){}} class C extends B {f(){const m=super.m;m(\"s\");}}new C().f();");
});

test("super extraction direct", () => {
  expectStaticTypeError("class B {get x():uint8{return 1;}} class C extends B {f(){let s:string=super.x;}}");
});

test("super extraction this control", () => {
  expectStaticTypeError("class B{get x():uint8{return 1;}}class C extends B{f(){const x=this.x;let s:string=x;}}");
});

test("super extract good", () => {
  expect(ok("class B{get x():uint8{return 1;}}class C extends B{f(){const x=super.x;let n:uint8=x;}}")).toBe(true);
});

test("super extract any", () => {
  expect(ok("class B{get x():any{return 1;}}class C extends B{f(){const x=super.x;let n:string=x;}}")).toBe(true);
});

test("super extract let", () => {
  expect(ok("class B{get x():uint8{return 1;}}class C extends B{f(){let x=super.x;let n:string=x;}}")).toBe(true);
});
