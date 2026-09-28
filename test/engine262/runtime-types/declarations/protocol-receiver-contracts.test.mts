import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-type-errors
test("rejects using explicit this bad", () => {
  expectStaticTypeError("function makeMethod() {\n  return Reflect.makeType({\n    kind: \"function\",\n    signatures: [{\n      parameters: [],\n      return: { type: type void },\n      thisType: type { x: uint8 }\n    }]\n  });\n}\ntype Method = makeMethod();\nfunction unused(r: { x: string, [Symbol.dispose]: Method }) {\n  using resource = r;\n}");
});

test("rejects iterator explicit this bad", () => {
  expectStaticTypeError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type Iterator.<uint8>},thisType:type {x:uint8}}]});}type Method=make();function unused(r:{x:string,[Symbol.iterator]:Method}){for(const x of r){}}");
});

test("rejects coercion explicit this bad", () => {
  expectStaticTypeError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[{name:\"hint\",type:type string}],return:{type:type string},thisType:type {x:uint8}}]});}type Method=make();function unused(r:{x:string,[Symbol.toPrimitive]:Method}){const s=`${r}`;}");
});

test("rejects then explicit this bad", () => {
  expectStaticTypeError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[{name:\"resolve\",type:type any},{name:\"reject\",type:type any}],return:{type:type void},thisType:type {x:uint8}}]});}type Method=make();async function unused(r:{x:string,then:Method}){await r;}");
});

test("accepts using explicit this good", () => {
  expect(ok("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type void},thisType:type {x:uint8}}]});}type Method=make(); function unused(r:{x:uint8,[Symbol.dispose]:Method}){using x=r;}")).toBe(true);
});

test("iterator next uses iterator receiver", () => {
  expectStaticTypeError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type {done:false,value:uint8}},thisType:type {x:uint8}}]});}type Method=make();function unused(r:{x:uint8,[Symbol.iterator]():{x:string,next:Method}}){for(const x of r){}}");
});

test("iterator close uses iterator receiver", () => {
  expectStaticTypeError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type {}},thisType:type {x:uint8}}]});}type Method=make();function unused(r:{x:uint8,[Symbol.iterator]():{x:string,next():{done:false,value:uint8},return:Method}}){const []=r;}");
});

test("async next uses iterator receiver", () => {
  expectStaticTypeError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type Promise.<{done:false,value:uint8}>},thisType:type {x:uint8}}]});}type Method=make();async function unused(r:{[Symbol.asyncIterator]():{x:string,next:Method}}){for await(const x of r){}}");
});

test("ordinary coercion uses original receiver", () => {
  expectStaticTypeError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type string},thisType:type {x:uint8}}]});}type Method=make();function unused(r:{x:string,[Symbol.toPrimitive]:undefined,toString:Method}){const s=`${r}`;}");
});

test("empty pattern does not call next", () => {
  expect(ok("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type {done:false,value:uint8}},thisType:type {x:uint8}}]});}type Method=make();function unused(r:{[Symbol.iterator]():{x:string,next:Method,return:undefined}}){const []=r;}")).toBe(true);
});

test("next accepts its actual iterator", () => {
  expect(ok("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type {done:false,value:uint8}},thisType:type {x:uint8}}]});}type Method=make();function unused(r:{x:string,[Symbol.iterator]():{x:uint8,next:Method}}){for(const x of r){}}")).toBe(true);
});

test("unknown receiver requirement defers", () => {
  expect(ok("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type void},thisType:type any}]});}type Method=make();function unused(r:{[Symbol.dispose]:Method}){using x=r;}")).toBe(true);
});

test("a viable receiver overload prevents failure", () => {
  expect(ok("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type void},thisType:type {x:uint8}},{parameters:[],return:{type:type void},thisType:type {x:string}}]});}type Method=make();function unused(r:{x:string,[Symbol.dispose]:Method}){using x=r;}")).toBe(true);
});

test("different failure reasons combine per signature", () => {
  expectStaticTypeError("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[],return:{type:type void},thisType:type {x:uint8}},{parameters:[{name:\"arg\",type:type uint8}],return:{type:type void},thisType:type {x:string}}]});}type Method=make();function unused(r:{x:string,[Symbol.dispose]:Method}){using x=r;}");
});

test("optional then receiver with viable path defers", () => {
  expect(ok("function make(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[{name:\"resolve\",type:type any},{name:\"reject\",type:type any}],return:{type:type void},thisType:type {x:uint8}}]});}type Method=make();async function unused(r:{x:string,then:Method|undefined}){await r;}")).toBe(true);
});
