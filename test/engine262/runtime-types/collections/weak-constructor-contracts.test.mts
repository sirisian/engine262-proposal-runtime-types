import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, expectThrownKind, evaluated } from '../harness.mts';

// #sec-library-constructor-contracts
test("rejects weakref typed bad", () => {
  expectStaticTypeError("function unused(x: uint8) {\n  new WeakRef.<object>(x);\n}");
});

test("rejects weakref named bad", () => {
  expectStaticTypeError("function unused(x:uint8){new WeakRef.<object>(target:x);}");
});

test("rejects weakref sealed", () => {
  expectStaticTypeError("class C{x:uint8=1;} function unused(c:C){new WeakRef.<object>(c);}");
});

test("rejects weakref typed wrong structural", () => {
  expectStaticTypeError("function unused(o:{x:string}){new WeakRef.<{x:uint8}>(o);}");
});

test("rejects finalization callback bad", () => {
  expectStaticTypeError("function unused() {\n  new FinalizationRegistry.<uint8>((held: string) => {});\n}");
});

test("rejects finalization context bad", () => {
  expectStaticTypeError("function unused(){new FinalizationRegistry.<uint8>(x=>{const s:string=x;});}");
});

test("rejects finalization constructor bad", () => {
  expectStaticTypeError("function unused(){new FinalizationRegistry.<uint8>(1);}");
});

test("accepts weakref typed good", () => {
  expect(ok("new WeakRef.<object>({});")).toBe(true);
});

test("accepts weakref typed symbol", () => {
  expect(ok("new WeakRef.<symbol>(Symbol());")).toBe(true);
});

test("accepts weakref any good", () => {
  expect(ok("function unused(x:any){new WeakRef.<object>(x);}")).toBe(true);
});

test("accepts weakref shadow good", () => {
  expect(ok("class WeakRef<T:type>{constructor(x:any){}} new WeakRef.<object>(1);")).toBe(true);
});

test("accepts finalization untyped good", () => {
  expect(ok("function unused(){new FinalizationRegistry.<uint8>(x=>{});}")).toBe(true);
});

test("accepts finalization return ignored good", () => {
  expect(ok("function unused(){new FinalizationRegistry.<uint8>((x:uint8):string=>\"s\");}")).toBe(true);
});

test("accepts finalization any good", () => {
  expect(ok("function unused(cb:any){new FinalizationRegistry.<uint8>(cb);}")).toBe(true);
});

test("accepts finalization shadow good", () => {
  expect(ok("class FinalizationRegistry<T:type>{constructor(x:any){}} new FinalizationRegistry.<uint8>(1);")).toBe(true);
});

test("accepts finalization good", () => {
  expect(ok("new FinalizationRegistry.<uint8>((x:uint8)=>{});")).toBe(true);
});

test("weak named good", () => {
  expect(ok("new WeakRef.<object>(target:{});")).toBe(true);
});

test("weak named spread bad", () => {
  expectStaticTypeError("function unused(x:uint8){new WeakRef.<object>(...{target:x});}");
});

test("weak named spread good", () => {
  expect(ok("new WeakRef.<object>(...{target:{}});")).toBe(true);
});

test("weak alias bad", () => {
  expectStaticTypeError("const W=WeakRef;function unused(x:uint8){new W.<object>(x);}");
});

test("weak named type bad", () => {
  expectStaticTypeError("function unused(x:{x:string}){new WeakRef.<T:{x:uint8}>(x);}");
});

test("weak dynamic target", () => {
  expectThrownKind("let x:any=1;new WeakRef.<object>(x);", 'TypeError');
});

test("weak dynamic structural", () => {
  expectThrownKind("let x:any={x:'s'};new WeakRef.<{x:uint8}>(x);", 'TypeError');
});

test("finalization named good", () => {
  expect(ok("new FinalizationRegistry.<uint8>(callback:(x:uint8)=>{});")).toBe(true);
});

test("finalization named bad", () => {
  expectStaticTypeError("function unused(){new FinalizationRegistry.<uint8>(callback:(x:string)=>{});}");
});

test("finalization named spread bad", () => {
  expectStaticTypeError("function unused(){new FinalizationRegistry.<uint8>(...{callback:(x:string)=>{}});}");
});

test("finalization optional good", () => {
  expect(ok("new FinalizationRegistry.<uint8>((x?:uint8)=>{});")).toBe(true);
});

test("finalization default good", () => {
  expect(ok("new FinalizationRegistry.<uint8>((x:uint8=1)=>{});")).toBe(true);
});

test("finalization rest good", () => {
  expect(ok("new FinalizationRegistry.<uint8>((...x:[].<uint8>)=>{});")).toBe(true);
});

test("finalization required extra bad", () => {
  expectStaticTypeError("function unused(){new FinalizationRegistry.<uint8>((x:uint8,y:string)=>{});}");
});

test("finalization dynamic callback", () => {
  expectThrownKind("let callback:any=(x:string)=>{};new FinalizationRegistry.<uint8>(callback);", 'TypeError');
});

test("finalization dynamic noncallable", () => {
  expectThrownKind("let callback:any=1;new FinalizationRegistry.<uint8>(callback);", 'TypeError');
});

test("finalization callback not run", () => {
  expect(evaluated("let called=false;new FinalizationRegistry.<uint8>(()=>{called=true;});String(called);")).toBe("false");
});

test("finalization untyped dynamic", () => {
  expectThrownKind("new FinalizationRegistry(1);", 'TypeError');
});
