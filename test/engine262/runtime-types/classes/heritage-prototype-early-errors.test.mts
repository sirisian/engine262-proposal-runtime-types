import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("R55: number prototype unused", () => {
  expectStaticTypeError("function f(base:{prototype:number}){globalThis.hookRan=true;class C extends base{}return C;}");
});

test("R55: number prototype executed", () => {
  expectStaticTypeError("function f(base:{prototype:number}){globalThis.hookRan=true;class C extends base{}return C;}function B(){}B.prototype=1;const base:any=B;f(base);");
});

test("R55: uint8 prototype unused", () => {
  expectStaticTypeError("function f(base:{prototype:uint8}){globalThis.hookRan=true;class C extends base{}return C;}");
});

test("R55: uint8 prototype executed", () => {
  expectStaticTypeError("function f(base:{prototype:uint8}){globalThis.hookRan=true;class C extends base{}return C;}function B(){}B.prototype=uint8(1);const base:any=B;f(base);");
});

test("R55: symbol prototype unused", () => {
  expectStaticTypeError("function f(base:{prototype:symbol}){globalThis.hookRan=true;class C extends base{}return C;}");
});

test("R55: symbol prototype executed", () => {
  expectStaticTypeError("function f(base:{prototype:symbol}){globalThis.hookRan=true;class C extends base{}return C;}function B(){}B.prototype=Symbol();const base:any=B;f(base);");
});

test("R55: undefined prototype unused", () => {
  expectStaticTypeError("function f(base:{prototype:undefined}){globalThis.hookRan=true;class C extends base{}return C;}");
});

test("R55: undefined prototype executed", () => {
  expectStaticTypeError("function f(base:{prototype:undefined}){globalThis.hookRan=true;class C extends base{}return C;}function B(){}B.prototype=undefined;const base:any=B;f(base);");
});

test("R55: number|undefined prototype unused", () => {
  expectStaticTypeError("function f(base:{prototype:number|undefined}){globalThis.hookRan=true;class C extends base{}return C;}");
});

test("R55: number|undefined prototype executed", () => {
  expectStaticTypeError("function f(base:{prototype:number|undefined}){globalThis.hookRan=true;class C extends base{}return C;}function B(){}B.prototype=1;const base:any=B;f(base);");
});

test("R55: class expression unused", () => {
  expectStaticTypeError("function f(base:{prototype:number}){return class extends base{};}");
});

test("R55: class expression executed", () => {
  expectStaticTypeError("function f(base:{prototype:number}){return class extends base{};}function B(){}B.prototype=1;const base:any=B;f(base);");
});

test("R55: null prototype", () => {
  expect(ok("function f(base:{prototype:null}){class C extends base{}}function B(){}B.prototype=null;const base:any=B;f(base);")).toBe(true);
});

test("R55: object prototype", () => {
  expect(ok("function f(base:{prototype:object}){class C extends base{}}function B(){}const base:any=B;f(base);")).toBe(true);
});

test("R55: viable prototype union", () => {
  expect(ok("function f(base:{prototype:number|null}){class C extends base{}}function B(){}B.prototype=null;const base:any=B;f(base);")).toBe(true);
});

test("R55: nullable base", () => {
  expect(ok("function f(base:{prototype:number}|null){class C extends base{}}f(null);")).toBe(true);
});

test("R55: unknown prototype member", () => {
  expect(ok("function f(base:object){class C extends base{}}const base:any=function B(){};f(base);")).toBe(true);
});

test("R55: unknown prototype type", () => {
  expect(ok("function f<T>(base:{prototype:T}){class C extends base{}}")).toBe(true);
});

test("R55: any retains runtime", () => {
  expectThrownKind("function f(base:any){class C extends base{}}function B(){}B.prototype=1;f(B);", "TypeError");
});

test("R55: plain JavaScript stays runtime", () => {
  expectThrownKind("function f(){function B(){}B.prototype=1;class C extends B{}}f();", "TypeError");
});

test("R55: existing nonconstructor heritage", () => {
  expectStaticTypeError("function f(base:uint8){class C extends base{}}");
});

test("R55: optional invalid prototype", () => {
  expectStaticTypeError("function f(base:{prototype?:number}){class C extends base{}}");
});

test("R55: array prototype type is valid", () => {
  expect(ok("function f(base:{prototype:[].<any>}){class C extends base{}return C;}function B(){}B.prototype=[];const b:any=B;f(b);")).toBe(true);
});

test("R55: getter prototype contract is checked", () => {
  expectStaticTypeError("class Bad {get prototype():number{return 1;}}function f(base:Bad){class C extends base{}}");
});

test("R55: inherited prototype contract is checked", () => {
  expectStaticTypeError("class Parent {prototype:number=1;}class Child extends Parent{}function f(base:Child){class C extends base{}}");
});

test("R55: specialized prototype contract is checked", () => {
  expectStaticTypeError("class Base<T>{prototype:T;}function f(base:Base.<number>){class C extends base{}}");
});

test("R55: generic unknown prototype remains dynamic", () => {
  expect(ok("class Base<T>{prototype:T;}function f<T>(base:Base.<T>){class C extends base{}}")).toBe(true);
});

test("R55: prototype with viable object alternative", () => {
  expect(ok("function f(base:{prototype:number|object}){class C extends base{}return C;}function B(){}const b:any=B;f(b);")).toBe(true);
});

test("R55: mixed bad base paths reject", () => {
  expectStaticTypeError("function f(base:number|{prototype:number}){class C extends base{}}");
});

test("R55: class self name stays in TDZ", () => {
  expectThrownKind("const C:{prototype:number}={prototype:1};function f(){class C extends C{}}f();", "ReferenceError");
});

test("R55: null prototype determines inheritance", () => {
  expect(evaluated("function f(base:{prototype:null}){class C extends base{}return C;}function B(){}B.prototype=null;const b:any=B;const C:any=f(b);String(Object.getPrototypeOf(C.prototype)===null);")).toBe("true");
});
