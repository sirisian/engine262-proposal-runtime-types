import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  "class A{m(x:uint8=1):void{}}class B extends A{m(x:uint8):void{}}",
  "class A{m(x?:uint8):void{}}class B extends A{m(x:uint8):void{}}",
  "class A{m(...x:[uint8,string]):void{}}class B extends A{m(x:[uint8,string]):void{}}",
  "class A{m(x:uint8=1):void{}}class B extends A{m(x:uint8):void{}}let a:A=new B();a.m();",
  "class A{m(...x:[uint8,string]):void{}}class B extends A{m(x:[uint8,string]):void{}}let a:A=new B();a.m(1,\"s\");"
])('rejects a disproved contract: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "class A{m(x:uint8=1):void{}}class B extends A{m(x:uint8=2):void{}}let a:A=new B();a.m();",
  "class A{m(...x:[uint8,string]):void{}}class B extends A{m(...x:[uint8,string]):void{}}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  'class A<T:type>{m(x?:T):void{}}class B<T:type> extends A.<T>{m(x:T):void{}}new B.<uint8>();',
  'class A<T:type>{m(x?:T):void{}}class B<T:type> extends A.<T>{m(x:T):void{}}function unused(x:B.<uint8>){}',
])('discharges an override obligation when its class arguments close: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  'class A<T:type>{m(x?:T):void{}}class B<T:type> extends A.<T>{m(x:T):void{}}',
  'class A<T:type>{m(x?:T):void{}}class B<T:type> extends A.<T>{m(x:T):void{}}new B.<any>();',
])('retains an open or omission-compatible specialization: %s', (source) => {
  expect(ok(source)).toBe(true);
});
