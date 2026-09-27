import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

const prelude = `type D = { m: int32 }; meta D { default = { m: 0 }; subtype(a:D,b:D):boolean {return a.m===b.m;} }
  type M = float32.<{m:1}>;
  function mul(a:D,b:D):D {return {m:a.m+b.m};}
  primitive float32<const L:D> {operator *.<R:D>(rhs:float32.<R>):float32.<mul(L,R)>;}`;

test('a known plain local supports precise metadata computation', () => {
  expect(evaluated(`${prelude} const scalar: float32 = 3; const meter = 2 := M;
    const answer: M = scalar * meter; String(answer);`)).toBe('6');
});

test('a bare parameter does not manufacture a default capture', () => {
  expect(evaluated(`${prelude} function product(a:float32,b:M) {return a*b;}
    String(Reflect.typeOf(product(2:=M,3:=M)));`)).toBe('float32.<{ m: 2 }>');
});

test('mutation invalidates a local plain fact', () => {
  expect(evaluated(`${prelude} let a:float32=2; a=(3:=M);
    const result=a*(2:=M); String(Reflect.typeOf(result));`)).toBe('float32.<{ m: 2 }>');
});

test('calls and borrowed mutation invalidate mutable facts', () => {
  expect(evaluated(`${prelude} let a:float32=2;
    function change() {a=(3:=M);} change(); const result=a*(2:=M);
    String(Reflect.typeOf(result));`)).toBe('float32.<{ m: 2 }>');
});

test('possible value-body results widen a bare static pair', () => {
  const blocks = `type D={m:int32}; meta D {default={m:0};subtype(a:D,b:D):boolean{return a.m===b.m;}}
    type M=float32.<{m:1}>; primitive float32<const L:D> {operator +(rhs:float32.<L>):string{return 'body';}}`;
  expect(evaluated(`${blocks} function f(a:float32,b:float32) {return a+b;}
    String(f(1:=float32,2:=float32))+'/'+f(1:=M,2:=M);`)).toBe('3/body');
  expectStaticTypeError(`${blocks} function f(a:float32,b:float32):float32 {return a+b;}`);
});

test('a peer literal adopts the base and cannot manufacture a unit', () => {
  expect(evaluated(`${prelude} const x=3*(2:=M); String(x)+'/'+String(Reflect.typeOf(x));`)).toBe('6/float32.<{ m: 1 }>');
  expectThrown(`${prelude} const m:M=3;`);
  expect(evaluated(`${prelude} String((2:=M)===2);`)).toBe('false');
});

test('selection and static result inference use the same exact-match tie-break', () => {
  expect(evaluated(`type D={r:number};meta D {default={r:1};subtype(a,b){return true;}conversionFactor(a,b){return a.r/b.r;}}
    type A=float64.<{r:2}>;type B=float64.<{r:3}>;
    primitive float64<const X:D>{operator +(rhs:float64.<X>):string{return 'converted';}operator +(rhs:B):boolean{return true;}}
    const answer:boolean=(1:=A)+(2:=B);String(answer);`)).toBe('true');
});

test('case labels and comparisons use base adoption', () => {
  expect(evaluated(`${prelude} let answer='quantity';switch(2:=M){case 2:answer='scalar';}
    answer+'/'+String((2:=M)==2);`)).toBe('quantity/true');
  expect(evaluated(`${prelude} primitive float32<const C:D>{operator >=(rhs:float32):boolean{return this>=rhs;}}
    String((2:=M)>=0);`)).toBe('true');
});

test('integer exponents and shift counts keep their existing domains', () => {
  expect(evaluated(`String(rational(2,3)**2)+'/'+String((4:=uint64)<<(1:=uint8));`)).toBe('4/9/8');
});
