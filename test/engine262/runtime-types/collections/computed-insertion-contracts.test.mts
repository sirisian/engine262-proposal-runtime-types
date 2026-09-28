import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

// #sec-keyed-collections

test("computed insertion result", () => {
  expectStaticTypeError("function unused(map: Map.<string, uint8>) {\n  map.getOrInsertComputed(\"key\", (key): string => \"bad\");\n}");
});

test("computed map callback parameter control", () => {
  expectStaticTypeError("function unused(m:Map.<string,uint8>){m.getOrInsertComputed(\"a\",(k:uint8):uint8=>k);}");
});

test("computed map direct set control", () => {
  expectStaticTypeError("function unused(m:Map.<string,uint8>){m.set(\"a\",\"s\");}");
});

test("computed map existing key", () => {
  expectStaticTypeError("const m=new Map.<string,uint8>();m.set(\"a\",1);m.getOrInsertComputed(\"a\",(k):string=>\"s\");");
});

test("computed map inline runtime", () => {
  expectStaticTypeError("const m=new Map.<string,uint8>(); m.getOrInsertComputed(\"a\",k=>\"bad\");");
});

test("computed weakmap bad", () => {
  expectStaticTypeError("function f(m:WeakMap.<object,uint8>,k:object){m.getOrInsertComputed(k,(x):string=>\"s\");}");
});

test("computed map any return", () => {
  expect(ok("function unused(m:Map.<string,uint8>,make:()=>any){m.getOrInsertComputed(\"a\",make);}")).toBe(true);
});

test("computed map good annotated", () => {
  expect(ok("function unused(m:Map.<string,uint8>){m.getOrInsertComputed(\"a\",(k):uint8=>1);}")).toBe(true);
});

test("computed map good contextual", () => {
  expect(ok("function unused(m:Map.<string,uint8>){m.getOrInsertComputed(\"a\",k=>1);}")).toBe(true);
});

test("computed insertion custom named", () => {
  expect(ok("function unused(o:{getOrInsertComputed:(k:string,cb:(k:string)=>string)=>string}){o.getOrInsertComputed(\"a\",(k):string=>\"s\");}")).toBe(true);
});

test("contextually types a computed insertion result", () => {
  expect(evaluated("const m=new Map.<string,uint8>();String(Reflect.typeOf(m.getOrInsertComputed(\"a\",k=>1)));")).toBe("uint.<8>");
});

test("keeps insertion enforcement for a dynamic callback result", () => {
  expect(evaluated("const m=new Map.<string,uint8>();const make:()=>any=()=>\"bad\";try{m.getOrInsertComputed(\"a\",make);}catch(e){e.constructor.name;}")).toBe("TypeError");
});
