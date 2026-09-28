import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

// #sec-iterator-helper-contracts

test("flatmap result eligibility", () => {
  expectStaticTypeError("function unused(map: Map.<string, uint8>) {\n  map.values().flatMap((value): uint8 => 1);\n}");
});

test("flatmap null", () => {
  expectStaticTypeError("function unused(m:Map.<string,uint8>){m.values().flatMap((x):null=>null);}");
});

test("flatmap noncallable control", () => {
  expectStaticTypeError("function unused(m:Map.<string,uint8>){m.values().flatMap(3);}");
});

test("iterator flatmap string runtime", () => {
  expectStaticTypeError("const m=new Map.<string,uint8>();m.set(\"a\",1);m.values().flatMap((x):string=>\"s\").toArray();");
});

test("iterator reduction accumulator", () => {
  expectStaticTypeError("function unused(map: Map.<string, uint8>) {\n  map.values().reduce((accumulator: string, value: uint8): string => accumulator);\n}");
});

test("reduce return recurrence bad", () => {
  expectStaticTypeError("function unused(m:Map.<string,uint8>){m.values().reduce((acc:uint8,x:uint8):string=>\"s\");}");
});

test("reduce known initial bad", () => {
  expectStaticTypeError("function unused(m:Map.<string,uint8>,n:uint8){m.values().reduce((acc:string,x:uint8):string=>acc,n);}");
});

test("reduce argument element control", () => {
  expectStaticTypeError("function unused(m:Map.<string,uint8>){m.values().reduce((acc:any,x:string):any=>acc);}");
});

test("reduce result bad", () => {
  expectStaticTypeError("function unused(m:Map.<string,uint8>){const s:string=m.values().reduce((acc:uint8,x:uint8):uint8=>acc,1);}");
});

test("flatmap unknown", () => {
  expect(ok("function unused(m:Map.<string,uint8>,mapper:(x:uint8)=>any){m.values().flatMap(mapper);}")).toBe(true);
});

test("flatmap iterable", () => {
  expect(ok("function unused(m:Map.<string,uint8>,xs:Iterable.<uint8>){m.values().flatMap((x):Iterable.<uint8>=>xs);}")).toBe(true);
});

test("flatmap returned iterator", () => {
  expect(ok("function unused(m:Map.<string,uint8>){m.values().flatMap((x)=>m.values());}")).toBe(true);
});

test("flatmap malformed next", () => {
  expect(ok("function unused(m:Map.<string,uint8>){m.values().flatMap((x):{next:uint8}=>({next:1}));}")).toBe(true);
});

test("iterator flatmap structural iterator", () => {
  expect(ok("function unused(m:Map.<string,uint8>){m.values().flatMap((x):{next:()=>{done:true,value:undefined}}=>({next(){return {done:true,value:undefined};}}));}")).toBe(true);
});

test("reduce good", () => {
  expect(ok("function unused(m:Map.<string,uint8>){m.values().reduce((acc:uint8,x:uint8):uint8=>acc);}")).toBe(true);
});

test("reduce explicit good", () => {
  expect(ok("function unused(m:Map.<string,uint8>){m.values().reduce((acc:string,x:uint8):string=>acc,\"\");}")).toBe(true);
});

test("reduce empty initial good", () => {
  expect(ok("const m=new Map.<string,uint8>();m.values().reduce((acc:string,x:uint8):string=>acc,\"\");")).toBe(true);
});

test("iterator reduce untyped initial", () => {
  expect(ok("function unused(m:Map.<string,uint8>,n:any){m.values().reduce((a:string,x:uint8):string=>a,n);}")).toBe(true);
});

test("flatmap custom named", () => {
  expect(ok("function unused(o:{flatMap:(cb:(n:uint8)=>uint8)=>void}){o.flatMap((x):uint8=>1);}")).toBe(true);
});

test("reduce custom named", () => {
  expect(ok("function unused(o:{reduce:(cb:(a:string,n:uint8)=>string)=>void}){o.reduce((a:string,n:uint8):string=>a);}")).toBe(true);
});

test("accepts direct iterator objects", () => {
  expect(evaluated("const m=new Map.<string,uint8>();m.set(\"a\",1);String(m.values().flatMap(x=>({next(){return {done:true,value:undefined};}})).toArray().length);")).toBe("0");
});

test("adopts an explicit numeric initial accumulator", () => {
  expect(ok("function f(m:Map.<string,uint8>){let n:uint8=m.values().reduce((a:uint8,x:uint8):uint8=>a,1);}")).toBe(true);
});

test("checks an inferred recurrence with contextual parameters", () => {
  expect(ok("function f(m:Map.<string,uint8>){let n:uint8=m.values().reduce((a,x)=>a);}")).toBe(true);
});

test("allows ignored accumulator callback parameters", () => {
  expect(ok("function f(m:Map.<string,uint8>){m.values().reduce(():uint8=>1);}")).toBe(true);
});

test("defers a dynamic callback return", () => {
  expect(ok("function f(m:Map.<string,uint8>,cb:(a:uint8,x:uint8)=>any){m.values().reduce(cb);}")).toBe(true);
});

test("admits a viable flattening union", () => {
  expect(ok("function f(m:Map.<string,uint8>,cb:(x:uint8)=>uint8|Iterable.<uint8>){m.values().flatMap(cb);}")).toBe(true);
});


test('checks equivalent computed helper names', () => {
  expectStaticTypeError('function f(m:Map.<string,uint8>){m.values()["flatMap"]((x):uint8=>1);}');
  expectStaticTypeError('function f(m:Map.<string,uint8>){m.values()["reduce"]((a:string,x:uint8):string=>a);}');
});

test('uses the contextual result to adopt a literal initial value', () => {
  expect(ok('function f(m:Map.<string,uint8>){let n:uint8=m.values().reduce((a,x)=>a,1);}')).toBe(true);
});

test('decays a reference initial accumulator', () => {
  expect(ok('function f(m:Map.<string,uint8>,n:uint8){let s:uint8=m.values().reduce((a:uint8,x:uint8):uint8=>a,ref n);}')).toBe(true);
});

test('maps named helper arguments before checking their contracts', () => {
  expectStaticTypeError('function f(m:Map.<string,uint8>){m.values().flatMap(callback:(x):uint8=>1);}');
  expectStaticTypeError('function f(m:Map.<string,uint8>){m.values().reduce(initial:"",callback:(a:uint8,x:uint8):uint8=>a);}');
  expect(ok('function f(m:Map.<string,uint8>){m.values().reduce(initial:"",callback:(a:string,x:uint8):string=>a);}')).toBe(true);
});
