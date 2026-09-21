import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("R50: Set add unused", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s[\"add\"](\"bad\");}");
});

test("R50: Set add executed", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s[\"add\"](\"bad\");}f(new Set.<uint8>());");
});

test("R50: Map value unused", () => {
  expectStaticTypeError("function f(m:Map.<string,uint8>){m[\"set\"](\"x\",\"bad\");}");
});

test("R50: Map value executed", () => {
  expectStaticTypeError("function f(m:Map.<string,uint8>){m[\"set\"](\"x\",\"bad\");}f(new Map.<string,uint8>());");
});

test("R50: Map key unused", () => {
  expectStaticTypeError("function f(m:Map.<uint8,string>){m[\"set\"](\"bad\",\"x\");}");
});

test("R50: Map key executed", () => {
  expectStaticTypeError("function f(m:Map.<uint8,string>){m[\"set\"](\"bad\",\"x\");}f(new Map.<uint8,string>());");
});

test("R50: const key unused", () => {
  expectStaticTypeError("const key=\"add\";function f(s:Set.<uint8>){s[key](\"bad\");}");
});

test("R50: const key executed", () => {
  expectStaticTypeError("const key=\"add\";function f(s:Set.<uint8>){s[key](\"bad\");}f(new Set.<uint8>());");
});

test("R50: parenthesized key unused", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s[(\"add\")](\"bad\");}");
});

test("R50: parenthesized key executed", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s[(\"add\")](\"bad\");}f(new Set.<uint8>());");
});

test("R50: Set valid", () => {
  expect(ok("function f(s:Set.<uint8>){s[\"add\"](1);}f(new Set.<uint8>());")).toBe(true);
});

test("R50: Map valid", () => {
  expect(ok("function f(m:Map.<string,uint8>){m[\"set\"](\"x\",1);}f(new Map.<string,uint8>());")).toBe(true);
});

test("R50: untyped collection", () => {
  expect(ok("function f(s:Set){s[\"add\"](\"ok\");}f(new Set());")).toBe(true);
});

test("R50: shadowed Set", () => {
  expect(ok("class Set<T>{add(n:string):void{}}function f(s:Set.<uint8>){s[\"add\"](\"ok\");}f(new Set.<uint8>());")).toBe(true);
});

test("R50: custom structural method", () => {
  expect(ok("function f(s:{add:(x:string)=>void}){s[\"add\"](\"ok\");}f({add(x:string):void{}});")).toBe(true);
});

test("R50: unknown key", () => {
  expect(ok("function f(s:Set.<uint8>,key:string){s[key](\"bad\");}")).toBe(true);
});

test("R50: dynamic override", () => {
  expect(ok("function f(s:any){s[\"add\"](\"ok\");}const s=new Set.<uint8>();s.add=(x:any)=>s;f(s);")).toBe(true);
});

test("R50: any boundary", () => {
  expectThrownKind("function f(s:any){s[\"add\"](\"bad\");}f(new Set.<uint8>());", 'TypeError');
});

test("R50: existing dot check", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){s.add(\"bad\");}");
});

test("R50: union collection signatures", () => {
  expectStaticTypeError("function f(s:Set.<uint8>|Set.<uint16>){s[\"add\"](\"bad\");}");
});

test("R50: union checked independently", () => {
  expectStaticTypeError("function f(s:Set.<uint8>|Set.<string>){s[\"add\"](\"bad\");}");
});

test("R50: weak collection absent member", () => {
  expectStaticTypeError("function f(s:WeakSet.<object>){s[\"size\"];}");
});

test("R50: count type is preserved", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){let n:boolean=s[\"size\"];}");
});

test("R50: computed read carries return type", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){let n:uint8=s[\"has\"](1);}");
});

test("R50: extracted method retains arguments", () => {
  expectStaticTypeError("function f(s:Set.<uint8>){const add=s[\"add\"];add(\"bad\");}");
});

test("R50: mutable key remains dynamic", () => {
  expect(ok("let key=\"add\";function f(s:Set.<uint8>){s[key](\"bad\");}")).toBe(true);
});

test("R50: user class dot also preserves signature", () => {
  expect(ok("class Set<T>{add(n:string):void{}}function f(s:Set.<uint8>){s.add(\"ok\");}f(new Set.<uint8>());")).toBe(true);
});

test("R50: user generic named parameter wins", () => {
  expect(ok("class Set<V>{add(n:V):void{}}function f(s:Set.<V:string>){s[\"add\"](\"ok\");}f(new Set.<string>());")).toBe(true);
});

test("R50: user class wrong argument rejected", () => {
  expectStaticTypeError("class Set<T>{add(n:string):void{}}function f(s:Set.<uint8>){s[\"add\"](Symbol());}");
});

test("R50: user generic alias shadows library", () => {
  expect(ok("type Set<T>={add:(n:string)=>void};function f(s:Set.<uint8>){s[\"add\"](\"ok\");}")).toBe(true);
});

test("R50: user weak class has no intrinsic key bound", () => {
  expect(ok("class WeakSet<T>{add(n:T):void{}}function f(s:WeakSet.<uint8>){s[\"add\"](1);}f(new WeakSet.<uint8>());")).toBe(true);
});

test("R50: computed calls preserve receiver and key effects", () => {
  expect(evaluated("let reads=0;function key():\"add\"{reads++;return \"add\";}const s:Set.<uint8>=new Set.<uint8>();s[key()](1);String(reads)+\",\"+String(s[\"has\"](1))+\",\"+String(s[\"size\"]);")).toBe("1,true,1");
});
