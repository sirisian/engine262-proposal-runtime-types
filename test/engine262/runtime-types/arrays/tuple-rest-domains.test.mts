import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "tuple rest scalar decl",
    "type T=[...uint8];"
  ],
  [
    "tuple rest generic",
    "type T<U:type>=[...U];function f(t:T.<uint8>){}"
  ],
  [
    "tuple rest string",
    "type T=[...string];let t:T=['x','y'];String(t.length);"
  ],
  [
    "rest param control",
    "function f(...args:uint8){}"
  ],
  [
    "closed any",
    "type T=[...any];"
  ],
  [
    "closed union",
    "type T=[...([].<uint8>|[].<string>)];"
  ],
  [
    "nested malformed tuple",
    "type T={x:[...boolean]};"
  ],
  [
    "generic function result",
    "function f<T:type>():[...T]{throw 1;}f.<uint8>();"
  ],
  [
    "generic function local",
    "function f<T:type>(){type R=[...T];}f.<uint8>();"
  ],
  [
    "closed reflected alias",
    "type T=Reflect.makeType({kind:'tuple',elements:[{type:uint8,rest:true}]});"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "tuple rest constrained",
    "type T<U:type extends [].<any>>=[...U];type R=T.<[uint8,string]>;"
  ],
  [
    "open declaration",
    "type T<U:type>=[...U];"
  ]
])('%s remains valid', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "tuple rest valid fixed",
    "type T=[...[2].<uint8>];let t:T=[1,2];String(t.length);",
    "2"
  ],
  [
    "tuple rest valid tuple",
    "type T=[...[uint8,string]];let t:T=[1,'x'];String(t.length);",
    "2"
  ],
  [
    "generic array rest",
    "type T<U:type>=[...U];let t:T.<[].<uint8>>=[1,2];String(t.length);",
    "2"
  ],
  [
    "array of union",
    "type T=[...[].<(uint8|string)>];let t:T=[1,'x'];String(t.length);",
    "2"
  ],
  [
    "collapsed union rest",
    "type T=[...([].<uint8>|[].<uint8>)];let t:T=[1,2];String(t.length);",
    "2"
  ],
  [
    "reflection roundtrip",
    "type T=[...[uint8,string]];String(Reflect.makeType(Reflect.getReflection(T))===T);",
    "true"
  ]
])('%s preserves its result', (_name, source, value) => {
  expect(evaluated(source)).toBe(value);
});

test("tuple class is rejected before evaluation", () => {
  expectStaticTypeError("class C<T:type>{x:[...T];}function f(c:C.<uint8>){}");
});

test("tuple inferred is rejected before evaluation", () => {
  expectStaticTypeError("function f<T:type>(x:T){type R=[...T];}f('bad');");
});

test("tuple method is rejected before evaluation", () => {
  expectStaticTypeError("class C{f<T:type>():[...T]{throw 1;}}new C().f.<uint8>();");
});

test("tuple shadow valid preserves behavior", () => {
  expect(ok("function f<T:type>(){function g<T:type>(){type R=[...T];}}f.<uint8>();")).toBe(true);
});

test("tuple class valid preserves behavior", () => {
  expect(evaluated("class C<T:type>{x:[...T];}const c=new C.<[].<uint8>>();String(c.x.length);")).toBe("0");
});

test("tuple reflect invalid remains a runtime TypeError", () => {
  expectThrownKind("Reflect.makeType({kind:'tuple',elements:[{type:uint8,rest:true}]});", 'TypeError');
});

test("tuple reflect nested remains a runtime TypeError", () => {
  expectThrownKind("Reflect.makeType({kind:'array',element:{kind:'tuple',elements:[{type:any,rest:true}]}});", 'TypeError');
});
