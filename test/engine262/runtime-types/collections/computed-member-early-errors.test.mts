import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("Set add unused", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s[\"add\"](\"bad\");}");
});

test("Set add executed", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s[\"add\"](\"bad\");}f(new Set.<uint8>());");
});

test("Map value unused", () => {
  expectStaticTypeError("function f(m:Map.<string,uint8>){m[\"set\"](\"x\",\"bad\");}");
});

test("Map value executed", () => {
  expectStaticTypeError("function f(m:Map.<string,uint8>){m[\"set\"](\"x\",\"bad\");}f(new Map.<string,uint8>());");
});

test("Map key unused", () => {
  expectStaticTypeError("function f(m:Map.<uint8,string>){m[\"set\"](\"bad\",\"x\");}");
});

test("Map key executed", () => {
  expectStaticTypeError("function f(m:Map.<uint8,string>){m[\"set\"](\"bad\",\"x\");}f(new Map.<uint8,string>());");
});

test("const key unused", () => {
  expectStaticTypeError("const key=\"add\";function f(s:Set.<uint8>){s[key](\"bad\");}");
});

test("const key executed", () => {
  expectStaticTypeError("const key=\"add\";function f(s:Set.<uint8>){s[key](\"bad\");}f(new Set.<uint8>());");
});

test("parenthesized key unused", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s[(\"add\")](\"bad\");}");
});

test("parenthesized key executed", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s[(\"add\")](\"bad\");}f(new Set.<uint8>());");
});

test("Set valid", () => {
  expect(ok("function f(s:Set.<uint8>){s[\"add\"](1);}f(new Set.<uint8>());")).toBe(true);
});

test("Map valid", () => {
  expect(ok("function f(m:Map.<string,uint8>){m[\"set\"](\"x\",1);}f(new Map.<string,uint8>());")).toBe(true);
});

test("untyped collection", () => {
  expect(ok("function f(s:Set){s[\"add\"](\"ok\");}f(new Set());")).toBe(true);
});

test("shadowed Set", () => {
  expect(ok("class Set<T: type>{add(n:string):void{}}function f(s:Set.<uint8>){s[\"add\"](\"ok\");}f(new Set.<uint8>());")).toBe(true);
});

test("custom structural method", () => {
  expect(ok("function f(s:{add:(x:string)=>void}){s[\"add\"](\"ok\");}f({add(x:string):void{}});")).toBe(true);
});

test("unknown key", () => {
  expect(ok("function f(s:Set.<uint8>,key:string){s[key](\"bad\");}")).toBe(true);
});

test("dynamic override", () => {
  expect(ok("function f(s:any){s[\"add\"](\"ok\");}const s=new Set.<uint8>();s.add=(x:any)=>s;f(s);")).toBe(true);
});

test("any boundary", () => {
  expectThrownKind("function f(s:any){s[\"add\"](\"bad\");}f(new Set.<uint8>());", 'TypeError');
});

test("existing dot check", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s.add(\"bad\");}");
});

test("union collection signatures", () => {
  expectStaticTypeError("function f(s:Set.<uint8>|Set.<uint16>){s[\"add\"](\"bad\");}");
});

test("union checked independently", () => {
  expectStaticTypeError("function f(s:Set.<uint8>|Set.<string>){s[\"add\"](\"bad\");}");
});

test("weak collection absent member", () => {
  expectStaticTypeError("function f(s:WeakSet.<object>){s[\"size\"];}");
});

test("count type is preserved", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){let n:boolean=s[\"size\"];}");
});

test("computed read carries return type", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){let n:uint8=s[\"has\"](1);}");
});

test("extracted method retains arguments", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){const add=s[\"add\"];add(\"bad\");}");
});

test("mutable key remains dynamic", () => {
  expect(ok("let key=\"add\";function f(s:Set.<uint8>){s[key](\"bad\");}")).toBe(true);
});

test("user class dot also preserves signature", () => {
  expect(ok("class Set<T: type>{add(n:string):void{}}function f(s:Set.<uint8>){s.add(\"ok\");}f(new Set.<uint8>());")).toBe(true);
});

test("user generic named parameter wins", () => {
  expect(ok("class Set<V: type>{add(n:V):void{}}function f(s:Set.<V:string>){s[\"add\"](\"ok\");}f(new Set.<string>());")).toBe(true);
});

test("user class wrong argument rejected", () => {
  expectStaticTypeError("class Set<T: type>{add(n:string):void{}}function f(s:Set.<uint8>){s[\"add\"](Symbol());}");
});

test("user generic alias shadows library", () => {
  expect(ok("type Set<T: type>={add:(n:string)=>void};function f(s:Set.<uint8>){s[\"add\"](\"ok\");}")).toBe(true);
});

test("user weak class has no intrinsic key bound", () => {
  expect(ok("class WeakSet<T: type>{add(n:T):void{}}function f(s:WeakSet.<uint8>){s[\"add\"](1);}f(new WeakSet.<uint8>());")).toBe(true);
});

test("computed calls preserve receiver and key effects", () => {
  expect(evaluated("let reads=0;function key():\"add\"{reads++;return \"add\";}const s:Set.<uint8>=new Set.<uint8>();s[key()](1);String(reads)+\",\"+String(s[\"has\"](1))+\",\"+String(s[\"size\"]);")).toBe("1,true,1");
});
