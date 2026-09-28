import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-static-iteration-contribution
test("rejects async loop typed bad", () => {
  expectStaticTypeError("async function unused(r: AsyncIterable.<string>) {\n  for await (const x: uint8 of r) {}\n}");
});

test("rejects async loop next bad", () => {
  expectStaticTypeError("async function unused(r:{[Symbol.asyncIterator]():{next():Promise.<{done:false,value:string}>}}){for await(const x of r){let n:uint8=x;}}");
});

test("rejects async iterator promise value", () => {
  expectStaticTypeError("async function unused(r:{[Symbol.asyncIterator]():{next():Promise.<{done:false,value:Promise.<string>}>}}){for await(const x:string of r){}}");
});

test("rejects async loop sync fallback bad", () => {
  expectStaticTypeError("async function unused(r:Iterable.<Promise.<string>>){for await(const x:uint8 of r){}}");
});

test("accepts async loop good", () => {
  expect(ok("async function unused(r:AsyncIterable.<uint8>){for await(const x:uint8 of r){}}")).toBe(true);
});

test("accepts async loop any good", () => {
  expect(ok("async function unused(r:any){for await(const x:uint8 of r){}}")).toBe(true);
});

test("accepts async loop promise good", () => {
  expect(ok("async function unused(r:{[Symbol.asyncIterator]():{next():Promise.<{done:false,value:Promise.<string>}>}}){for await(const x:Promise.<string> of r){break;}}")).toBe(true);
});

test("async binding body", () => {
  expectStaticTypeError("async function unused(r:AsyncIterable.<string>){for await(const x of r){const n:uint8=x;}}");
});

test("async assignment head", () => {
  expectStaticTypeError("async function unused(r:AsyncIterable.<string>){let x:uint8=0;for await(x of r){}}");
});

test("async union", () => {
  expectStaticTypeError("async function unused(r:AsyncIterable.<string>|AsyncIterable.<boolean>){for await(const x:uint8 of r){}}");
});

test("async done only", () => {
  expect(ok("async function unused(r:{[Symbol.asyncIterator]():{next():Promise.<{done:true,value:string}>}}){for await(const x:uint8 of r){}}")).toBe(true);
});

test("async optional mixed", () => {
  expect(ok("async function unused(r:{[Symbol.asyncIterator]?():{next():Promise.<{done:false,value:string}>},[Symbol.iterator]():Iterator.<uint8>}){for await(const x:string|uint8 of r){}}")).toBe(true);
});

test("async unknown alternative", () => {
  expect(ok("async function unused(r:{[Symbol.asyncIterator]:any,[Symbol.iterator]():Iterator.<string>}){for await(const x:uint8 of r){}}")).toBe(true);
});
