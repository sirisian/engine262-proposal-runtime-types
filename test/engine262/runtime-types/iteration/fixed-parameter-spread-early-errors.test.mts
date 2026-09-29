import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("one element unused", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{yield \"bad\";}");
});

test("one element executed", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{yield \"bad\";}f({[Symbol.iterator]:words});");
});

test("no elements unused", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{}");
});

test("no elements executed", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{}f({[Symbol.iterator]:words});");
});

test("several elements unused", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{yield \"bad\";yield \"worse\";}");
});

test("several elements executed", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{yield \"bad\";yield \"worse\";}f({[Symbol.iterator]:words});");
});

test("constructor unused", () => {
  expectStaticTypeError("class C{constructor(n:uint8){globalThis.hookRan=true;}}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){new C(...s);}function* words():Generator.<string,void,void>{yield \"bad\";}");
});

test("constructor executed", () => {
  expectStaticTypeError("class C{constructor(n:uint8){globalThis.hookRan=true;}}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){new C(...s);}function* words():Generator.<string,void,void>{yield \"bad\";}f({[Symbol.iterator]:words});");
});

test("optional permits empty", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n?:uint8):void{}function* words():Generator.<string,void,void>{}f({[Symbol.iterator]:words});")).toBe(true);
});

test("default permits empty", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n:uint8=1):void{}function* words():Generator.<string,void,void>{}f({[Symbol.iterator]:words});")).toBe(true);
});

test("undefined permits empty", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n:uint8|undefined):void{}function* words():Generator.<string,void,void>{}f({[Symbol.iterator]:words});")).toBe(true);
});

test("union accepts string", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n:uint8|string):void{}function* words():Generator.<string,void,void>{yield \"ok\";}f({[Symbol.iterator]:words});")).toBe(true);
});

test("untyped parameter", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n):void{}function* words():Generator.<string,void,void>{yield \"ok\";}f({[Symbol.iterator]:words});")).toBe(true);
});

test("named argument spread", () => {
  expect(ok("function take(n:uint8):void{}function f(){take(...{n:1});}f();")).toBe(true);
});

test("unknown source", () => {
  expect(ok("function take(n:uint8):void{}function f(s:any){take(...s);}f([1]);")).toBe(true);
});

test("numeric contribution valid", () => {
  expect(ok("function take(n:uint8):void{}function f(s:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}){take(...s);}function* words():Generator.<uint8,void,void>{yield 1;}f({[Symbol.iterator]:words});")).toBe(true);
});

test("any callee", () => {
  expectThrownKind("function f(g:any,s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){g(...s);}function take(n:uint8):void{}function* words():Generator.<string,void,void>{yield \"bad\";}f(take,{[Symbol.iterator]:words});", 'TypeError');
});

test("prefix already checked", () => {
  expectStaticTypeError("function take(n:uint8):void{}function f(s:any){take(\"bad\",...s);}");
});

test("known prefix", () => {
  expectStaticTypeError("function take(s:string,n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(\"x\",...xs);}");
});

test("later impossible slot", () => {
  expectStaticTypeError("function take(s:string,n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs);}");
});

test("known suffix can fill required slot", () => {
  expect(ok("function take(s:string|undefined,n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs,1);}")).toBe(true);
});

test("rest layout deferred", () => {
  expect(ok("function take(...s:[].<string>,n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs);}")).toBe(true);
});

test("multiple spreads deferred", () => {
  expect(ok("function take(n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>},ys:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}){take(...xs,...ys);}")).toBe(true);
});

test("upstream number to string conversion", () => {
  // The conversion happens where the element's type is not known statically:
  // an iterable of `any` spreads into a `string` parameter and each element
  // converts at the boundary, `RequireType` handing the `string` target to
  // `PrimitiveConvert`.
  expect(ok("function take(s:string):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<any,void,void>}){take(...xs);}")).toBe(true);
  // An iterable of `number` is typed statically, and static assignability has
  // no conversion in it, so no count of such elements satisfies a `string`
  // parameter. This test once used `number` here, from before the spread's
  // element type was checked statically.
  expect(ok("function take(s:string):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<number,void,void>}){take(...xs);}")).toBe(false);
});

test("unknown generic contribution", () => {
  expect(ok("function take(n:uint8):void{}function f<T: type>(xs:{[Symbol.iterator]:()=>Generator.<T,void,void>}){take(...xs);}")).toBe(true);
});

test("mutable array iterator unknown", () => {
  expect(ok("function take(n:uint8):void{}function f(xs:[].<string>){take(...xs);}")).toBe(true);
});

test("super fixed parameter", () => {
  expectStaticTypeError("class B{constructor(n:uint8){}}class D extends B{constructor(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){super(...xs);}}");
});

test("all invalid overloads", () => {
  expectStaticTypeError("function take(n:uint8):void{}function take(n:boolean):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs);}");
});

test("viable overload", () => {
  expect(ok("function take(n:uint8):void{}function take(n:string):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs);}")).toBe(true);
});

test("iteration is performed once and effects survive", () => {
  expect(evaluated("let visits=0;function take(n:uint8):void{}const xs:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}={[Symbol.iterator]:function*():Generator.<uint8,void,void>{visits++;yield uint8(1);}};take(...xs);String(visits);")).toBe("1");
});

test("replacement array iterator supplies actual arguments", () => {
  expect(evaluated("function take(n:uint8):uint8{return n;}let xs:[].<string>=[\"bad\"];xs[Symbol.iterator]=function*(){yield uint8(9);};String(take(...xs));")).toBe("9");
});

test('a Symbol-keyed array property has no indexed element contract', () => {
  expect(evaluated('const key=Symbol();let a:[].<uint8>=[1];a[key]="ok";a[key];')).toBe('ok');
  expect(ok('function f(a:[].<uint8>,key:symbol){a[key]="ok";}')).toBe(true);
});

test('numeric indexed writes still enforce the element contract', () => {
  expectStaticTypeError('function f(a:[].<uint8>){a[0]="bad";}');
});
