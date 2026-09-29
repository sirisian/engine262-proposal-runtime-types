import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-generator-types

test("async delegation contribution", () => {
  expectStaticTypeError("async function* unused(source: AsyncIterable.<string>)\n  : AsyncGenerator.<uint8, void, void> {\n  yield* source;\n}");
});

test("async delegate non done string", () => {
  expectStaticTypeError("async function* unused(xs:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:false,value:string},any>}}):AsyncGenerator.<uint8,void,void>{yield* xs;}");
});

test("async delegate promise value", () => {
  expectStaticTypeError("async function* unused(xs:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:false,value:Promise.<string,any>},any>}}):AsyncGenerator.<uint8,void,void>{yield* xs;}");
});

test("async forawait control", () => {
  expectStaticTypeError("async function unused(xs:AsyncIterable.<string>){for await(const x:uint8 of xs){}}");
});

test("async yield delegate structural result", () => {
  expectStaticTypeError("async function* f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:true,value:string},any>}}):AsyncGenerator.<uint8,uint8,void> { return yield* xs; }");
});

test("sync yield delegate structural result", () => {
  expectStaticTypeError("function* f(xs:{[Symbol.iterator]:()=>{next:()=>{done:true,value:string}}}):Generator.<uint8,uint8,void> { return yield* xs; }");
});

test("async yield delegate result", () => {
  expectStaticTypeError("async function* f(xs:AsyncGenerator.<uint8,string,void>):AsyncGenerator.<uint8,uint8,void> { return yield* xs; }");
});

test("async delegate good", () => {
  expect(ok("async function* unused(xs:AsyncIterable.<uint8>):AsyncGenerator.<uint8,void,void>{yield* xs;}")).toBe(true);
});

test("async delegate any", () => {
  expect(ok("async function* unused(xs:AsyncIterable.<any>):AsyncGenerator.<uint8,void,void>{yield* xs;}")).toBe(true);
});

test("async delegate done string", () => {
  expect(ok("async function* unused(xs:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:true,value:string},any>}}):AsyncGenerator.<uint8,void,void>{yield* xs;}")).toBe(true);
});

test("async delegate promise good", () => {
  expect(ok("async function* unused(xs:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:false,value:Promise.<uint8,any>},any>}}):AsyncGenerator.<uint8,void,void>{yield* xs;}")).toBe(true);
});

test("ignores a discarded synchronous terminal string", () => {
  expect(ok("function* f(xs:{[Symbol.iterator]:()=>{next:()=>{done:true,value:string}}}):Generator.<uint8,void,void>{yield* xs;}")).toBe(true);
});

test("checks a structural terminal local binding", () => {
  expectStaticTypeError("async function* f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:true,value:string},any>}}):AsyncGenerator.<uint8,void,void>{let n:uint8=yield* xs;}");
});

test("defers unknown step values", () => {
  expect(ok("async function* f(xs:{[Symbol.asyncIterator]:()=>{next:()=>any}}):AsyncGenerator.<uint8,void,void>{yield* xs;}")).toBe(true);
});
