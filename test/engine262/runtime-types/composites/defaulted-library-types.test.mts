import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

test("Promise default arguments participate in every judgment", () => {
  expectEarlyError("function f(p:Promise.<uint8>){p.then((x:string):void=>{});}", "StaticTypeError");
  expectEarlyError("function f(p:Promise.<uint8>){let q:Promise.<string>=p.then((x:uint8):uint8=>x);}", "StaticTypeError");
  expectEarlyError("async function f(p:Promise.<uint8>){let s:string=await p;}", "StaticTypeError");
  expectEarlyError("function f(p:Promise.<uint8>){p.finally((x:string):void=>{});}", "StaticTypeError");
  expectEarlyError("type P=Promise.<uint8>;function f(p:P){p.then((x:string):void=>{});}", "StaticTypeError");
  expectEarlyError("function f(){const p=Promise.resolve(1:=uint8);p.then((x:string):void=>{});}", "StaticTypeError");
});

test("completed and explicitly written Promise defaults agree", () => {
  expect(evaluated("function f(p:Promise.<uint8,string>){p.then((x:uint8):void=>{});}; \"ok\";")).toBe("ok");
  expect(evaluated("function f(p: Promise.<uint8>): Promise.<uint8, any> { return p; } function g(p: Promise.<uint8, any>): Promise.<uint8> { return p; }; \"ok\";")).toBe("ok");
});

test("readonly index signatures are rejected instead of discarded", () => {
  expectEarlyError("function f(x:{readonly [key:string]:uint8}){x.a=1;}", "SyntaxError");
  expectEarlyError("type T = { readonly [key: symbol]: uint8 };", "SyntaxError");
  expectEarlyError("interface T { readonly [key: string]: uint8; }", "SyntaxError");
});

test("readonly named properties retain their contract", () => {
  expectEarlyError("function f(x:{readonly a:uint8}){x.a=1;}", "StaticTypeError");
});

test("a property named readonly remains legal", () => {
  expect(evaluated("type T = { readonly: uint8 }; let t: T = { readonly: 1 }; t.readonly = 2;; \"ok\";")).toBe("ok");
});
