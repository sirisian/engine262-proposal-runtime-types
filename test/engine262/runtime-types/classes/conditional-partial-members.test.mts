import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-partial-classes and #sec-matchspecializationpattern.

test("fixed before", () => {
  expect(evaluated("class B<T:type>{}partial class B<uint8>{extra():uint8{return 7;}}String(new B.<uint8>().extra());")).toBe("7");
});

test("fixed after", () => {
  expect(evaluated("class B<T:type>{}const before=new B.<uint8>();const ctor=B.<uint8>;partial class B<uint8>{extra():uint8{return 7;}}String(before.extra())+String(ctor===B.<uint8>);")).toBe("7true");
});

test("nonmatch", () => {
  expect(evaluated("class B<T:type>{}partial class B<uint8>{extra():uint8{return 7;}}String(typeof new B.<string>().extra);")).toBe("undefined");
});

test("all matches", () => {
  expect(evaluated("class B<T:type>{}partial class B<const E>{one():uint8{return 1;}}partial class B<uint8>{two():uint8{return 2;}}String(new B.<uint8>().one())+String(new B.<uint8>().two());")).toBe("12");
});

test("unconditional", () => {
  expect(evaluated("class B<T:type>{v:T;constructor(v:T){this.v=v;}}partial class B{value():T{return this.v;}}String(new B.<uint8>(7).value());")).toBe("7");
});

test("capture", () => {
  expect(evaluated("class B<T:type>{v:T;constructor(v:T){this.v=v;}}partial class B<const E extends uint8|uint16>{value():E{return this.v;}}String(new B.<uint8>(7).value());")).toBe("7");
});

test("interface present", () => {
  expect(evaluated("interface I<T:type>{v:T;}partial interface I<uint8>{extra:string;}let x:I.<uint8>={v:1,extra:'x'};String(x.extra);")).toBe("x");
});

test("interface nonmatch", () => {
  expect(evaluated("interface I<T:type>{v:T;}partial interface I<uint8>{extra:string;}let x:I.<string>={v:'x'};String(x.v);")).toBe("x");
});

test("interface capture", () => {
  expect(evaluated("interface I<T:type>{v:T;}partial interface I<const E>{copy:E;}let x:I.<uint8>={v:1,copy:2};String(x.copy);")).toBe("2");
});

test("nested user", () => {
  expect(evaluated("class Box<T:type>{}function f<T:type>():string{return 'base';}function f<Box.<[].<const E>>>():string{return 'box';}f.<Box.<[].<uint8>>>();")).toBe("box");
});

test("nested map", () => {
  expect(evaluated("function f<T:type>():string{return 'base';}function f<Map.<K:string,V:const E>>():string{return 'map';}f.<Map.<string,uint8>>();")).toBe("map");
});

test("collision", () => {
  expectStaticTypeError("class B<T:type>{m():uint8{return 1;}}partial class B<uint8>{m():uint8{return 2;}}new B.<uint8>();");
});

test("interface missing", () => {
  expectStaticTypeError("interface I<T:type>{v:T;}partial interface I<uint8>{extra:string;}let x:I.<uint8>={v:1};");
});

test("a dependent bound admits a declared implementation", () => {
  expect(evaluated("interface Has<T: type> { get(): T; } class E implements Has.<E> { get(): E { return this; } } class B<T: type> {} partial class B<const V extends Has.<V>> { yes(): string { return \"yes\"; } } new B.<E>().yes();")).toBe("yes");
});

test("a dependent bound excludes an unrelated type", () => {
  expect(evaluated("interface Has<T: type> { get(): T; } class B<T: type> {} partial class B<const V extends Has.<V>> { yes(): string { return \"yes\"; } } typeof new B.<string>().yes;")).toBe("undefined");
});

test("a wildcard adds no binding or constraint", () => {
  expect(evaluated("class B<T: type, N: uint32> {} partial class B<_, 4> { yes(): string { return \"yes\"; } } new B.<uint8, 4>().yes();")).toBe("yes");
});

test("every matching contribution is added", () => {
  expect(evaluated("class B<T: type> {} partial class B<uint8> { one(): string { return \"one\"; } } partial class B<uint8> { two(): string { return \"two\"; } } new B.<uint8>().one() + new B.<uint8>().two();")).toBe("onetwo");
});

test("a default application receives conditional members", () => {
  expect(evaluated("class B<T: type = uint8> {} partial class B<uint8> { yes(): string { return \"yes\"; } } new B().yes();")).toBe("yes");
});

test("nominal patterns complete omitted arguments from defaults", () => {
  expect(evaluated("class B<T: type, U: type = string> {} function f<X: type>(): string { return \"fallback\"; } function f<B.<const T>>(): string { return \"case\"; } f.<B.<uint8>>();")).toBe("case");
});

test("nominal patterns resolve immutable constructor aliases", () => {
  expect(evaluated("class B<T: type> {} const Alias = B; function f<X: type>(): string { return \"fallback\"; } function f<Alias.<const T>>(): string { return \"case\"; } f.<B.<uint8>>();")).toBe("case");
});

test("interface extensions preserve existing type object identity", () => {
  expect(evaluated("interface B<T: type> { v: T; } const Before = B.<uint8>; partial interface B<uint8> { other: string; } String(({v: 1 := uint8}) is Before) + String(Before === B.<uint8>);")).toBe("falsetrue");
});

test("a forward nominal record retains its declared interfaces", () => {
  expect(evaluated("interface Has<T: type> { get(): T; } class E implements Has.<E> { get(): E { return this; } } String(Reflect.isAssignable(E, Has.<E>));")).toBe("true");
});

test("callable patterns instantiate dependent nominal bounds", () => {
  expect(evaluated("interface Has<T: type> { get(): T; } class E implements Has.<E> { get(): E { return this; } } function f<T: type>(): string { return \"no\"; } function f<const V extends Has.<V>>(): string { return \"yes\"; } f.<E>();")).toBe("yes");
});

test("a matching dependent interface bound contributes required members", () => {
  expectStaticTypeError("interface Has<T: type> { get(): T; } class E implements Has.<E> { get(): E { return this; } } interface B<T: type> {} partial interface B<const V extends Has.<V>> { required: string; } let b: B.<E> = {};");
});

test("a static partial method checks its arguments", () => {
  expectStaticTypeError("class B<T: type> {} partial class B<uint8> { static takes(x: uint8): uint8 { return x; } } B.<uint8>.takes(\"bad\");");
});

test("nested labels name parameters of the receiving constructor", () => {
  expectStaticTypeError("class B<T: type> {} partial class B<Map.<Oops: const V>> { yes() {} }");
});

test("a known collision is rejected without constructing an instance", () => {
  expectStaticTypeError("class B<T: type> { m() {} } partial class B<uint8> { m() {} }");
});

test('a failed deferred extension preserves existing methods and prototype integrity', () => {
  expect(evaluated('class B<T: type> { v: uint8 = 0; m() { return "base"; } } const C = B.<uint8>; let refused = false; try { eval(\'partial class B<uint8> { m() { return "replacement"; } }\'); } catch (e) { refused = e instanceof TypeError; } String(refused) + "|" + String(Object.isFrozen(C.prototype)) + "|" + new C().m();')).toBe('true|true|base');
});


test('a conditional operator substitutes its capture in the result', () => {
  expect(evaluated('class B<T: type> { v: T; constructor(v: T) { this.v = v; } } partial class B<const E> { operator+(other: B.<E>): E { return this.v; } } const b = new B.<uint8>(3); String(b + b);')).toBe('3');
});

test('an operator contribution cannot replace an existing operator', () => {
  expectStaticTypeError('class B<T: type> { operator+(o: B.<T>): string { return "base"; } } partial class B<uint8> { operator+(o: B.<uint8>): string { return "replacement"; } } new B.<uint8>();');
});


test('an immutable family alias resolves the partial target', () => {
  expectStaticTypeError('class B<T: type> {} const Alias = B; partial class Alias<uint8> { m(x: uint8): uint8 { return x; } } new B.<uint8>().m("bad");');
  expect(evaluated('class B<T: type> {} const Alias = B; partial class Alias<uint8> { m(): string { return "ok"; } } new B.<uint8>().m();')).toBe('ok');
});


test('an unused conditional interface still checks computed member keys', () => {
  expectStaticTypeError('let key = Symbol("key"); interface I<T: type> {} partial interface I<uint8> { [key]: string; }');
  expect(evaluated('const key = Symbol("key"); interface I<T: type> {} partial interface I<uint8> { [key]: string; } "ok";')).toBe('ok');
});
