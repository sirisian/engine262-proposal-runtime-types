import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  [
    "protected bracket",
    "value class A{protected x:uint8;}function f(a:A){a['x'];}"
  ],
  [
    "protected union",
    "value class A{protected x:uint8;}value class B{protected x:uint8;}function f(a:A|B){a.x;}"
  ],
  [
    "protected method",
    "class A{protected f():void{}}function g(a:A){a.f();}"
  ],
  [
    "protected getter",
    "class A{protected get x():uint8{return 1;}}function f(a:A){a.x;}"
  ],
  [
    "protected static good syntax",
    "function f(){class A{static protected x:uint8;}A.x;}"
  ],
  [
    "protected single",
    "value class A{protected x:uint8;}function f(a:A){a.x;}"
  ],
  [
    "finite keys",
    "value class A{protected x:uint8;protected y:uint8;}function f(a:A,k:'x'|'y'){a[k];}"
  ],
  [
    "mixed union",
    "value class A{protected x:uint8;}value class B{x:uint8;}function f(a:A|B){a.x;}"
  ],
  [
    "inherited declaration",
    "value class A{protected x:uint8;}value class B extends A{}function f(b:B){b['x'];}"
  ],
  [
    "protected setter",
    "class A{protected set x(v:uint8){}}function f(a:A){a.x=1;}"
  ],
  [
    "static method",
    "function f(){class A{static protected f():void{}}A['f']();}"
  ],
  [
    "optional access",
    "value class A{protected x:uint8;}function f(a:A|null){a?.['x'];}"
  ],
  [
    "unrelated this receiver",
    "value class A{protected x:uint8;}class B{f(a:A){a.x;}}"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "protected good",
    "value class A{protected x:uint8;f(){return this.x;}}value class B extends A{f(){return this.x;}}"
  ],
  [
    "protected any control",
    "value class A{protected x:uint8;}function f(a:any){a.x;}"
  ],
  [
    "dynamic key",
    "value class A{protected x:uint8;}function f(a:A,k:string){a[k];}"
  ]
])('%s remains valid', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "subclass computed access",
    "value class A{protected x:uint8=1;}value class B extends A{f(a:A):uint8{return a['x'];}}String(new B().f(new A()));",
    "1"
  ],
  [
    "subclass static access",
    "class A{static protected x:uint8=1;}class B extends A{static f():uint8{return A['x'];}}String(B.f());",
    "1"
  ],
  [
    "public override",
    "class A{protected f():uint8{return 0;}}class B extends A{f():uint8{return 1;}}String(new B().f());",
    "1"
  ]
])('%s preserves its result', (_name, source, value) => {
  expect(evaluated(source)).toBe(value);
});

test("protected symbol is rejected before evaluation", () => {
  expectStaticTypeError("class A{protected [Symbol.iterator]():void{}}function f(a:A){a[Symbol.iterator]();}");
});

test("protected abstract is rejected before evaluation", () => {
  expectStaticTypeError("abstract class A{protected f():void;}function f(a:A){a.f();}");
});

test("protected same name is rejected before evaluation", () => {
  expectStaticTypeError("value class A{protected x:uint8;}function f(a:A){class A{f(){a.x;}}}");
});

test("protected generic is rejected before evaluation", () => {
  expectStaticTypeError("class A<T:type>{protected x:T;}function f(a:A.<uint8>){a['x'];}");
});

test("protected permitted mixed is rejected before evaluation", () => {
  expectStaticTypeError("value class A{protected x:uint8;f(a:A|B){a.x;}}value class B{protected x:uint8;}");
});
