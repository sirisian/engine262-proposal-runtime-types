import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-typed-classes

test("aliased heritage contract", () => {
  expectStaticTypeError("class Base { value: uint8 = 0; }\nconst Alias = Base;\nclass Derived extends Alias {\n  change() { this.value = \"bad\"; }\n}");
});

test("heritage alias chain bad", () => {
  expectStaticTypeError("class B{x:uint8=0;}const A=B;const Alias=A;class C extends Alias{f(){this.x=\"s\";}}");
});

test("heritage alias parenthesized bad", () => {
  expectStaticTypeError("class B{x:uint8=0;}const Alias=(B);class C extends Alias{f(){this.x=\"s\";}}");
});

test("heritage alias generic bad", () => {
  expectStaticTypeError("class B<T:type>{x:T;}const Alias=B.<uint8>;class C extends Alias{f(){this.x=\"s\";}}");
});

test("heritage alias abstract bad", () => {
  expectStaticTypeError("abstract class B{abstract f():uint8;}const Alias=B;class C extends Alias{}");
});

test("heritage direct abstract control", () => {
  expectStaticTypeError("abstract class B{abstract f():uint8;}class C extends B{}");
});

test("heritage alias method", () => {
  expectStaticTypeError("class B {m(x:uint8){}} const Alias=B; class C extends Alias {f(){this.m(\"s\");}}");
});

test("heritage alias constructor", () => {
  expectStaticTypeError("class B {constructor(x:uint8){}} const Alias=B; class C extends Alias {} function unused(){new C(\"s\");}");
});

test("heritage alias override", () => {
  expectStaticTypeError("class B {m():uint8{return 1;}} const Alias=B; class C extends Alias {m():string{return \"s\";}}");
});

test("heritage direct field", () => {
  expectStaticTypeError("class B {x:uint8=0;} class C extends B {f(){this.x=\"s\";}}");
});

test("heritage parens bad", () => {
  expectStaticTypeError("class B{x:uint8=0;}class C extends (B){f(){this.x=\"s\";}}");
});

test("heritage alias good", () => {
  expect(ok("class B{x:uint8=0;}const Alias=B;class C extends Alias{f(){this.x=1;}}")).toBe(true);
});

test("heritage alias unknown", () => {
  expect(ok("const Alias:any=class{ x=0; };class C extends Alias{f(){this.x=\"s\";}}")).toBe(true);
});

test("heritage alias shadow good", () => {
  expect(ok("class B{x:uint8=0;}const Alias=B;function f(){const Alias=class{x:string=\"s\";};class C extends Alias{f(){this.x=\"s\";}}}")).toBe(true);
});

test("defers a mutable constructor alias", () => {
  expect(ok("class B{x:uint8=0;}let Alias=B;class C extends Alias{f(){this.x=\"s\";}}")).toBe(true);
});

test("defers an unknown mixin result", () => {
  expect(ok("class B{x:uint8=0;}function f(mixin:any){class C extends mixin(B){f(){this.x=\"s\";}}}")).toBe(true);
});

test("substitutes a closed alias in the default constructor", () => {
  expectStaticTypeError("class B<T:type>{constructor(x:T){}}const A=B.<uint8>;class C extends A{}function f(){new C(\"s\");}");
});

test("preserves specialized library heritage", () => {
  expect(ok("class M extends Map.<string,uint8>{}function f(m:M){m.set(\"a\",1);}")).toBe(true);
});


test('specializes inherited static contracts through an alias', () => {
  expect(ok('class B<T:type>{static x:T;}const A=B.<uint8>;class C extends A{static f(){this.x=1;}}')).toBe(true);
  expectStaticTypeError('class B<T:type>{static x:T;}const A=B.<uint8>;class C extends A{static f(){this.x="s";}}');
});
