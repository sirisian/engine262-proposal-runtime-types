import { test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

// #sec-generics: enclosing parameters stay fixed throughout a generic body.

test("class local alias control", () => {
  evaluated("class B<T:type>{mk():Map.<string,uint8>{const Alias=Map;return new Alias();}}");
});

test("class local shadow", () => {
  evaluated("class B<T:type>{mk():Map.<string,uint8>{const B=Map;return new B();}}");
});

test("class local shadow nongeneric", () => {
  evaluated("class B{mk():Map.<string,uint8>{const B=Map;return new B();}}");
});

test("closed extent length", () => {
  expectStaticTypeError("class S{b:[4].<uint8>;get len():string{return this.b.length;}}");
});

test("method own generic valid", () => {
  evaluated("class B<T:type>{m<U:type>(v:U){}mk():void{this.m((1:=uint16));}}");
});

test("method parameter construction resolved", () => {
  expectStaticTypeError("class B<T:type>{constructor(v:T){}mk<U:type>(u:U):void{new B(u);}}");
});

test("open extent length", () => {
  expectStaticTypeError("class S<N:uint32>{b:[N].<uint8>;get len():string{return this.b.length;}}");
});

test("open method call", () => {
  expectStaticTypeError("class B<T:type>{m(v:T){}mk():void{this.m((1:=uint16));}}");
});

test("open method valid", () => {
  evaluated("class B<T:type>{m(v:T){}mk(v:T):void{this.m(v);}}");
});

test("overloaded constructor", () => {
  expectStaticTypeError("class B<T:type>{constructor(v:T){}constructor(v:T,w:T){}mk():void{new B((1:=uint16));}}");
});

test("overloaded constructor closed", () => {
  expectStaticTypeError("class B<T:type>{constructor(v:T){}constructor(v:T,w:T){}}function unused(){new B.<uint8>((1:=uint16));}");
});


test('a missing interface member names the selected application', () => {
  const source = 'interface Store<T: type> { get(): T; } interface Store<boolean> { get(): boolean; bits(): uint8; } class P implements Store.<boolean> { get(): boolean { return true; } }';
  expectStaticTypeError(source);
  expectThrown(source, 'Store.<boolean>');
});
