import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, expectThrownKind, evaluated } from '../harness.mts';

// #sec-typed-classes
test("rejects override method field", () => {
  expectStaticTypeError("class B { m(): uint8 { return 1; } }\nclass D extends B { m: string = \"s\"; }");
});

test("rejects override getter field", () => {
  expectStaticTypeError("class B{get x():uint8{return 1;}} class D extends B{x:string=\"s\";}");
});

test("rejects override method field nested", () => {
  expectStaticTypeError("class B{m():uint8{return 1;}} class D extends B{} class E extends D{m:string=\"s\";}");
});

test("rejects override field field", () => {
  expectStaticTypeError("class B{x:uint8=1;} class D extends B{x:string=\"s\";}");
});

test("accepts override method field good", () => {
  expect(ok("class B{m():uint8{return 1;}} class D extends B{m:()=>uint8=()=>1;} let b:B=new D();String(b.m());")).toBe(true);
});

test("accepts override getter field good", () => {
  expect(ok("class B{get x():uint8{return 1;}} class D extends B{x:uint8=2;} let b:B=new D();String(b.x);")).toBe(true);
});

test("accepts override method untyped good", () => {
  expect(ok("class B{m(){return 1;}} class D extends B{m=\"s\";}")).toBe(true);
});

test("accepts override mask any good", () => {
  expect(ok("class B{m():uint8{return 1;}} class D extends B{m:any=\"s\";}")).toBe(true);
});

test("inherited setter bad", () => {
  expectStaticTypeError("class B{set x(v:uint8){}}class D extends B{x:string='s';}");
});

test("inherited setter good", () => {
  expect(ok("class B{set x(v:uint8){}}class D extends B{x:uint8=1;}")).toBe(true);
});

test("inherited setter readonly", () => {
  expectStaticTypeError("class B{set x(v:uint8){}}class D extends B{readonly x:uint8=1;}");
});

test("inherited method parameters", () => {
  expectStaticTypeError("class B{m(x:uint8):uint8{return x;}}class D extends B{m:(x:string)=>uint8=()=>1;}");
});

test("inherited generic bad", () => {
  expectThrownKind("class B<T:type>{m():T{throw 1;}}class D<T:type> extends B.<T>{m:string='s';}new D.<uint8>();", 'TypeError');
});

test("inherited generic good", () => {
  expect(ok("class B<T:type>{get x():T{throw 1;}}class D<T:type> extends B.<T>{x:T;constructor(x:T){super();this.x=x;}}new D.<uint8>(1);")).toBe(true);
});

test("inherited own field precedence", () => {
  expect(evaluated("class B{x:uint8=1;}class D extends B{x():string{return 's';}}let d:D=new D();const x:uint8=d.x;String(x);")).toBe("1");
});

test("inherited private field", () => {
  expect(ok("class B{get x():uint8{return 1;}}class D extends B{#x:string=\"s\";}")).toBe(true);
});

test("inherited distinct symbol", () => {
  expect(ok("const a=Symbol();const b=Symbol();class B{[a]():uint8{return 1;}}class D extends B{[b]:string=\"s\";}")).toBe(true);
});

test('a function field checks its explicit receiver against the instance', () => {
  const contract = `function make(){return Reflect.makeType({kind:"function",signatures:[{
    parameters:[],return:{type:type uint8},thisType:type {x:uint8}
  }]});}type Method=make();class B{m():uint8{return 1;}}`;
  expect(ok(contract + 'class D extends B{x:uint8=1;m:Method=function(){return 1;};}new D();')).toBe(true);
  expectStaticTypeError(contract + 'class D extends B{x:string="s";m:Method=function(){return 1;};}');
});
