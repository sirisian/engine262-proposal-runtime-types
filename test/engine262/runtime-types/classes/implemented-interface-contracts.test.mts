import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

// #sec-interfaces-semantics
test("rejects interface index bad", () => {
  expectStaticTypeError("interface I { [key: string]: uint8; }\nclass C implements I { x: string = \"s\"; }");
});

test("rejects interface index generic bad", () => {
  expectStaticTypeError("interface I<T:type>{[k:string]:T;} class C implements I.<uint8>{x:string=\"s\";}");
});

test("rejects interface index inherited bad", () => {
  expectStaticTypeError("interface I {[k:string]:uint8;} class A {x:string=\"s\";} class B extends A implements I {}");
});

test("rejects interface alias bad", () => {
  expectStaticTypeError("interface I { x: uint8; }\ntype Alias = I;\nclass C implements Alias {}");
});

test("rejects interface alias chain bad", () => {
  expectStaticTypeError("interface I{x:uint8;} type A=I;type B=A;class C implements B{}");
});

test("rejects interface alias bad type", () => {
  expectStaticTypeError("interface I {x:uint8;} type A=I; class C implements A {x:string=\"s\";}");
});

test("rejects interface generic named", () => {
  expectStaticTypeError("interface I<A: type, B: type> { x: A; y: B; }\nclass C implements I.<B: string, A: uint8> {\n  x: string = \"s\";\n  y: uint8 = 1;\n}");
});

test("rejects interface generic named bad bound", () => {
  expectStaticTypeError("interface I<T:type extends uint8>{x:T;} class C implements I.<T:string>{x:string=\"s\";}");
});

test("rejects interface generic missing", () => {
  expectStaticTypeError("interface I<T:type>{} class C implements I {}");
});

test("accepts interface index good", () => {
  expect(ok("interface I{[k:string]:uint8;} class C implements I{x:uint8=1;}")).toBe(true);
});

test("accepts interface index symbol good", () => {
  expect(ok("interface I{[k:symbol]:uint8;} class C implements I{x:string=\"s\";}")).toBe(true);
});

test("accepts interface index exempt", () => {
  expect(ok("interface I{x:string;[k:string]:uint8;} class C implements I{x:string=\"s\";}")).toBe(true);
});

test("accepts interface index method", () => {
  expect(ok("interface I{[k:string]:uint8;} class C implements I{x():void{}}")).toBe(true);
});

test("accepts interface index method exempt good", () => {
  expect(ok("interface I{m():void;[k:string]:uint8;} class C implements I{m():void{}}")).toBe(true);
});

test("accepts interface alias good", () => {
  expect(ok("interface I{x:uint8;} type Alias=I; class C implements Alias{x:uint8=1;} let x:I=new C();")).toBe(true);
});

test("accepts interface alias good declaration", () => {
  expect(ok("interface I{x:uint8;} type Alias=I; class C implements Alias{x:uint8=1;}")).toBe(true);
});

test("accepts interface generic positional good", () => {
  expect(ok("interface I<A:type,B:type>{x:A;y:B;} class C implements I.<uint8,string>{x:uint8=1;y:string=\"s\";}")).toBe(true);
});

test("accepts interface generic named good", () => {
  expect(ok("interface I<A:type,B:type>{x:A;y:B;} class C implements I.<B:string,A:uint8>{x:uint8=1;y:string=\"s\";}")).toBe(true);
});

test("accepts interface default good", () => {
  expect(ok("interface I<T:type=uint8>{x:T;} class C implements I{x:uint8=1;}")).toBe(true);
});

test("index method assignment", () => {
  expect(ok("interface I{[k:string]:uint8;}class C implements I{m():string{return 's';}}const c:I=new C();")).toBe(true);
});

test("index symbol bad", () => {
  expectStaticTypeError("const k=Symbol();interface I{[k:symbol]:uint8;}class C implements I{[k]:string='s';}");
});

test("index symbol exempt", () => {
  expect(ok("const k=Symbol();interface I{[k]:string;[key:symbol]:uint8;}class C implements I{[k]:string='s';}")).toBe(true);
});

test("alias reflection", () => {
  expect(evaluated("interface I{x:uint8;}type Alias=I;class C implements Alias{x:uint8=1;}String(Reflect.isAssignable(type C,type I));")).toBe("true");
});

test("alias generic", () => {
  expect(ok("interface I<T:type>{x:T;}type Alias<T:type>=I.<T>;class C implements Alias.<uint8>{x:uint8=1;}let i:I.<uint8>=new C();")).toBe(true);
});

test("alias shadow good", () => {
  expect(ok("interface I{x:uint8;}function unused(){interface I{y:string;}type Alias=I;class C implements Alias{y:string='s';}let i:I=new C();}")).toBe(true);
});

test("alias shadow bad", () => {
  expectStaticTypeError("interface I{x:uint8;}type Outer=I;function unused(){interface I{y:string;}class C implements Outer{x:uint8=1;}let i:I=new C();}");
});

test("implements noninterface", () => {
  expectStaticTypeError("type Alias={x:uint8};class C implements Alias{x:uint8=1;}");
});

test("implements primitive", () => {
  expectStaticTypeError("type Alias=uint8;class C implements Alias{}");
});

test("generic dependent default", () => {
  expect(ok("interface I<A:type=uint8,B:type=A>{x:B;}class C implements I{x:uint8=1;}let i:I=new C();")).toBe(true);
});

test("generic class implements", () => {
  expect(ok("interface I<T:type>{x:T;}class C<T:type> implements I.<T>{x:T;constructor(x:T){this.x=x;}}let i:I.<uint8>=new C.<uint8>(1);")).toBe(true);
});

test("generic empty interface identity", () => {
  expectStaticTypeError("interface I<T:type>{}class C implements I.<uint8>{}let i:I.<string>=new C();");
});

test("generic index inherited", () => {
  expectStaticTypeError("interface I{[k:string]:uint8;}class B<T:type>{x:T;constructor(x:T){this.x=x;}}class C extends B.<string> implements I{}");
});

test("alias same spelling", () => {
  expect(ok("interface Outer{x:uint8;}type Alias=Outer;function unused(){interface Inner{y:string;}type Alias=Inner;class C implements Alias{y:string=\"s\";}let i:Inner=new C();}")).toBe(true);
});

test("interface generic named alias", () => {
  expect(ok("interface I<A:type,B:type>{x:A;y:B;}type Alias=I.<B:string,A:uint8>;class C implements Alias{x:uint8=1;y:string=\"s\";}" )).toBe(true);
});

test("interface invalid default", () => {
  expectStaticTypeError("interface I<T:type extends uint8=string>{x:T;}class C implements I{x:string=\"s\";}");
});

test('a closed generic alias keeps its supplied arguments', () => {
  expectStaticTypeError('interface I<T:type>{x:T;}type Alias=I.<uint8>;class C implements Alias{x:string="s";}');
  expect(ok('interface I<T:type>{x:T;}type Alias=I.<uint8>;class C implements Alias{x:uint8=1;}let i:I.<uint8>=new C();')).toBe(true);
});

test('a selected interface case includes its operator obligations', () => {
  const family = 'interface I<T:type>{}interface I<boolean>{operator<(rhs:boolean):boolean;}';
  expectStaticTypeError(family + 'class C implements I.<T:boolean>{}');
  expect(ok(family + 'class C implements I.<T:boolean>{operator<(rhs:boolean):boolean{return true;}}')).toBe(true);
});

test('named arguments specialize operator contracts', () => {
  const head = 'interface I<A:type,B:type>{operator<(rhs:A):B;}';
  expectStaticTypeError(head + 'class C implements I.<B:boolean,A:uint8>{operator<(rhs:string):boolean{return true;}}');
  expect(ok(head + 'class C implements I.<B:boolean,A:uint8>{operator<(rhs:uint8):boolean{return true;}}')).toBe(true);
});
