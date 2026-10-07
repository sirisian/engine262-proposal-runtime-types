import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

test("predicates retain named generic and method contracts", () => {
  expectEarlyError("function guard(a:any,b:any): b is uint8 {return true;} function f(x:uint8,y:string){if(guard(b:y,a:x)) {}}", "StaticTypeError");
  expectEarlyError("function guard<T:type>(x:any): x is T{return true;} function f(x:string){if(guard.<uint8>(x)){}}", "StaticTypeError");
  expectEarlyError("class G{test(x:any):x is uint8{return true;}} function f(g:G,x:string){if(g.test(x)){}}", "StaticTypeError");
  expectEarlyError("function g(a:any,b:any):b is uint8{return true;}function f(x:string,y:string){if(g(a:x,b:y)){}}", "StaticTypeError");
});

test("predicate branches use the argument that actually binds the target", () => {
  expect(evaluated("function g(a:any,b:any):b is uint8{return true;} function f(x:string,y:uint8|string){if(g(b:y,a:x)){let n:uint8=y;}}; \"ok\";")).toBe("ok");
  expect(evaluated("function g<T:type>(x:any):x is T{return true;} function f(x:uint8|string){if(g.<uint8>(x)){let n:uint8=x;}}; \"ok\";")).toBe("ok");
  expect(evaluated("class G{test(x:any):x is uint8{return true;}}function f(g:G,x:uint8|string){if(g.test(x)){let n:uint8=x;}}; \"ok\";")).toBe("ok");
  expect(evaluated("function guard<T: type>(typeHint: T, x: any): x is T { return true; } function f(x: uint8|string, hint: uint8) { if (guard(x: x, typeHint: hint)) { let n: uint8 = x; } }; \"ok\";")).toBe("ok");
  expect(evaluated("const o = { guard(x: any): x is uint8 { return true; } }; function f(x: uint8|string) { if(o.guard(x: x)) { let n: uint8 = x; } }; \"ok\";")).toBe("ok");
});

test("mutation still invalidates predicates and their bodies return boolean", () => {
  expectEarlyError("function g(x:any):x is uint8{return true;} function f(x:uint8|string){if(g(x)){x=\"bad\";let y:uint8=x;}}", "StaticTypeError");
  expectEarlyError("class G{test(x:any):x is uint8{return \"bad\";}}", "StaticTypeError");
});

test("explicit receiver contracts are checked when a receiver is supplied", () => {
  expectEarlyError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type uint8},thisType:type {x:uint8}}]});} type F=make(); function f(o:{x:string,m:F}){o.m();}", "StaticTypeError");
  expectEarlyError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type uint8},thisType:type {x:uint8}}]});} type F=make(); function f(g:F){g();}", "StaticTypeError");
  expectEarlyError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type uint8},thisType:type {x:uint8}}]});} type F=make(); let o:{x:string,m:F}={x:\"bad\",m:function(){return this.x;}};o.m();", "StaticTypeError");
});

test("matching explicit receivers remain callable", () => {
  expect(evaluated("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type uint8},thisType:type {x:uint8}}]});} type F=make(); function f(o:{x:uint8,m:F}){o.m();}; \"ok\";")).toBe("ok");
  expect(evaluated("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type uint8},thisType:type {x:uint8}}]});} type F=make(); let o:{x:uint8,m:F}={x:1,m:function(){return this.x;}};String(o.m());; \"ok\";")).toBe("ok");
});

test("callable intersections retain argument result and reference contracts", () => {
  expectEarlyError("function f(x:((uint8)=>void)&{tag:string}){x(\"bad\");}", "StaticTypeError");
  expectEarlyError("function f(x:((uint8)=>uint8)&{tag:string}){let s:string=x(1);}", "StaticTypeError");
  expectEarlyError("function f(x:((ref a:uint8)=>void)&{tag:string}){x(1);}", "StaticTypeError");
  expectEarlyError("function f(x:((uint8)=>void)&{tag:string}){x?.(\"bad\");}", "StaticTypeError");
  expectEarlyError("function f(x:((uint8)=>void)&{tag:string}){x`text`;}", "StaticTypeError");
  expectEarlyError("function f(x:(((uint8)=>void)&{tag:string})|((uint8)=>void)){x(\"bad\");}", "StaticTypeError");
});

test("callable intersections retain their keyed shape", () => {
  expect(evaluated("function g(n:uint8):uint8{return n;}g.tag=\"x\";let u:any=g;let f:((uint8)=>uint8)&{tag:string}=u;String(f(2));; \"ok\";")).toBe("ok");
});

const methodType = 'function makeMethod() { return Reflect.makeType({ kind: "function", signatures: [{ parameters: [], return: { type: type uint8 }, thisType: type { x: uint8 } }] }); } type Method = makeMethod(); ';

test('receiver entry checks precede the body through erased aliases', () => {
  expect(evaluated(methodType + 'globalThis.entered = false; let o: { x: string, m: Method } = { x: "bad", m: function() { globalThis.entered = true; return 1; } }; let erased: any = o; try { erased.m(); } catch(e) { } String(globalThis.entered);')).toBe('false');
  expect(evaluated(methodType + 'globalThis.entered = false; let o: { x: uint8, m: Method } = { x: 1, m: function() { globalThis.entered = true; return 1; } }; let erased: any = o; erased.m(); String(globalThis.entered);')).toBe('true');
});

test('optional member calls retain explicit receiver contracts', () => {
  expectEarlyError(methodType + 'function unused(o: { x: string, m: Method }) { o.m?.(); }', 'StaticTypeError');
});

const assertionType = 'function makeAssert() { return Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name: "a", type: type any }, { name: "b", type: type any }], narrows: [{ target: "b", type: type uint8 }] }] }); } type Assertion = makeAssert(); const assertByte: Assertion = (a, b) => {}; ';

test('named assertions narrow only dominated reads of the mapped target', () => {
  expect(evaluated(assertionType + 'function unused(x: string, y: uint8 | string) { assertByte(b: y, a: x); let n: uint8 = y; } "ok";')).toBe('ok');
  expectEarlyError(assertionType + 'function unused(x: string, y: uint8 | string) { assertByte(b: y, a: x); let n: uint8 = x; }', 'StaticTypeError');
  expectEarlyError(assertionType + 'function unused(x: string, y: uint8 | string) { let n: uint8 = y; assertByte(b: y, a: x); }', 'StaticTypeError');
  expectEarlyError(assertionType + 'function unused(x: string, y: uint8 | string) { assertByte(b: y, a: x); y = "changed"; let n: uint8 = y; }', 'StaticTypeError');
});

test('a selected predicate retains every declared target', () => {
  const guard = 'function make() { return Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name:"a",type:type any },{ name:"b",type:type any }], return: { type:type boolean }, narrows: [{ target:"a",type:type uint8 },{ target:"b",type:type uint8 }] }] }); } type Guard=make(); const g:Guard=(a,b)=>true; ';
  expect(evaluated(guard + 'function unused(x: uint8|string,y:uint8|string) { if(g(b:y,a:x)) { let a:uint8=x; let b:uint8=y; } } "ok";')).toBe('ok');
});
test('a typed call view enforces its receiver after erased installation', () => {
  expect(evaluated(methodType + 'globalThis.entered=false; function implementation():uint8 { globalThis.entered=true; return 1; } let erased:any=implementation; const o:{x:any,m:Method}={x:"bad",m:erased}; try {o.m();} catch(e) {} String(globalThis.entered);')).toBe('false');
  expect(evaluated(methodType + 'globalThis.entered=false; function implementation():uint8 { globalThis.entered=true; return 1; } let erased:any=implementation; const o:{x:any,m:Method|null}={x:"bad",m:erased}; try {o.m?.();} catch(e) {} String(globalThis.entered);')).toBe('false');
  expect(evaluated(methodType + 'globalThis.entered=false; function implementation():uint8 { globalThis.entered=true; return 1; } let erased:any=implementation; const o:{x:uint8,m:Method}={x:1,m:erased}; function invoke(factory:(()=>{x:uint8,m:Method})|null){factory?.().m();} invoke(()=>o); String(globalThis.entered);')).toBe('true');
});
