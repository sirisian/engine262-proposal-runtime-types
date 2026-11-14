import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-iteration-types: the protocols are interface types. A class may name
 * one in `implements`, an interface may extend one, and `IterableIterator`
 * extends `Iterable` and `Iterator` as its declaration writes. Their members
 * are methods, so a class's method is one by the ordinary rule, and a
 * hand-written function that declares no receiver is one by #sec-this-adoption.
 */
const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};
const Bag = 'class Bag implements Iterable.<uint8> { *[Symbol.iterator](): Generator.<uint8> { yield 1 := uint8; yield 2 := uint8; } } ';

test('a class implements Iterable and reaches an Iterable position', () => {
  expect(evaluated(`${Bag}function f(x: Iterable.<uint8>): uint8 { let t: uint8 = 0; for (const v of x) t += v; return t; } String(f(new Bag()));`)).toBe('3');
  expect(evaluated(`${Bag}String(Reflect.isAssignable(Bag, Iterable.<uint8>)) + String(Reflect.isAssignable(Bag, Iterable.<string>));`)).toBe('truefalse');
  refused('class Bad implements Iterable.<uint8> { }', 'rt-implements-contract');
});

test('the design\'s own example: a class with a method and an object with an arrow are both an Iterator', () => {
  const Cursor = 'class Cursor implements Iterator.<uint8> { n: uint8 = 0; next(): IteratorResult.<uint8, void> { this.n += 1; return this.n > 2 ? { value: undefined, done: true } : { value: this.n, done: false }; } } '
    + 'function drain(it: Iterator.<uint8>): string { const r = it.next(); return String(r.value); } ';
  expect(evaluated(`${Cursor}drain(new Cursor());`)).toBe('1');
  expect(evaluated(`${Cursor}drain({ next: () => ({ value: 7, done: false }) });`)).toBe('7');
  expect(evaluated(`${Cursor}drain({ next() { return { value: 9, done: false }; } });`)).toBe('9');
});

test('a class that implements IterableIterator is an Iterable and an Iterator', () => {
  const It = 'class It implements IterableIterator.<uint8> { n: uint8 = 0; next(): IteratorResult.<uint8> { this.n += 1; return this.n > 2 ? { value: undefined, done: true } : { value: this.n, done: false }; } '
    + '[Symbol.iterator](): Iterator.<uint8> { return this; } } function f(x: Iterable.<uint8>) { return 1; } function g(x: Iterator.<uint8>) { return 2; } ';
  expect(evaluated(`${It}String(f(new It())) + String(g(new It()));`)).toBe('12');
  // As an expression `Iterator` is the class the helpers live on, so the
  // protocol is named here through the interface that extends it.
  expect(evaluated(`${It}String(Reflect.isAssignable(It, Iterable.<uint8>)) + String(Reflect.isAssignable(It, IterableIterator.<uint8>));`)).toBe('truetrue');
});

test('a protocol\'s member is a method: it is not called without its receiver', () => {
  refused('function f(it: Iterator.<uint8>) { const n = it.next; return n(); }', 'rt-this-required');
});

test('what satisfied a protocol before still does', () => {
  const f = 'function f(x: Iterable.<uint8>): uint8 { let t: uint8 = 0; for (const v of x) t += v; return t; } ';
  expect(evaluated(`${f}const a: [].<uint8> = [1, 2]; String(f(a)) + String(f(new Set.<uint8>(a)));`)).toBe('33');
  expect(evaluated('function* g(): Generator.<uint8> { yield 1 := uint8; } function f(x: Iterable.<uint8>) { return 1; } String(f(g()));')).toBe('1');
  expect(evaluated('async function* ag(): AsyncGenerator.<uint8> { yield 1 := uint8; } function f(x: AsyncIterable.<uint8>) { return 1; } String(f(ag()));')).toBe('1');
  expect(evaluated('function first<T: type>(x: Iterable.<T>): T { for (const v of x) return v; throw new Error("empty"); } const a: [].<uint8> = [7, 8]; String(first(a));')).toBe('7');
  expect(evaluated('function f(v: any) { return v is Iterable.<uint8>; } const a: [].<uint8> = [1]; String(f(a)) + String(f({})) + String(f("s"));')).toBe('truefalsefalse');
});

test('the protocols relate by declaration and reflect as interfaces', () => {
  expect(evaluated('String(Reflect.isAssignable(IterableIterator.<uint8>, Iterable.<uint8>)) + String(Reflect.isAssignable(Iterable.<uint8>, IterableIterator.<uint8>));')).toBe('truefalse');
  expect(evaluated("const n = Reflect.getReflection.<Reflect.Type>(IterableIterator.<uint8>); n.kind + '/' + Object.keys(n).join(',');")).toBe('primitive/kind,type,family,generic');
  expect(evaluated("const r = Reflect.getReflection.<Reflect.Interface, IterableIterator.<uint8>>(); r.name + '/' + String(r.extends.length) + '/' + String(r.extends[0] === Iterable.<uint8>);")).toBe('IterableIterator/2/true');
  expect(evaluated('String(Reflect.getReflection.<Reflect.Interface, Iterable.<uint8>>().extends.length) + String(Iterable.<uint8> === Iterable.<uint8>);')).toBe('0true');
  expect(evaluated("interface Counted<T: type> extends Iterable.<T> { count: uint8; } String(Reflect.isAssignable(Counted.<uint8>, Iterable.<uint8>)) + String(Reflect.getReflection.<Reflect.Interface, Counted.<uint8>>().extends[0] === Iterable.<uint8>);")).toBe('truetrue');
});

test('an interface that extends a generic application reaches it, invariantly', () => {
  const G = 'interface G<T: type> { v: T; } ';
  expect(evaluated(`${G}interface H extends G.<uint8> { w: uint8; } String(Reflect.isAssignable(H, G.<uint8>)) + String(Reflect.isAssignable(H, G.<uint16>));`)).toBe('truefalse');
  expect(evaluated(`${G}interface H<T: type> extends G.<T> { w: T; } String(Reflect.isAssignable(H.<uint8>, G.<uint8>)) + String(Reflect.isAssignable(H.<uint8>, G.<uint16>));`)).toBe('truefalse');
});

test('a hook annotated with the protocol it returns is the hook the protocol asks for', () => {
  // A protocol's member is a method, and a method member is read-only, so it
  // is compared covariantly: the hook may return the Iterator interface, or a
  // subtype of it, whether the object is written in place or held in a variable.
  const f = 'function f(x: Iterable.<uint8>) { return 1; } const a: [].<uint8> = [1]; ';
  expect(evaluated(`${f}String(f({ [Symbol.iterator](): Iterator.<uint8> { return a.values(); } }));`)).toBe('1');
  expect(evaluated(`${f}const o = { [Symbol.iterator](): Iterator.<uint8> { return a.values(); } }; String(f(o));`)).toBe('1');
  expect(evaluated(`${f}const o = { [Symbol.iterator](): IterableIterator.<uint8> { return a.values(); } }; String(f(o));`)).toBe('1');
  expect(evaluated(`${f}function mk(): Iterator.<uint8> { return a.values(); } const o = { [Symbol.iterator]: mk }; String(f(o));`)).toBe('1');
  expect(evaluated(`${f}const o = { [Symbol.iterator]: (): Iterator.<uint8> => a.values() }; String(f(o));`)).toBe('1');
  refused(`${f}const o = { [Symbol.iterator](): Iterator.<string> { return ['s'].values(); } }; f(o);`, 'rt-assignability');
});

test('a built-in\'s declared protocol outranks an interface of the same shape', () => {
  // #sec-resolveoverload: a `Set` declares `Iterable`; it has the members of
  // `Mine` and declared nothing about it.
  expect(evaluated("interface Mine { [Symbol.iterator](): Iterator.<uint8>; } function pick(x: Iterable.<uint8>): string { return 'protocol'; } "
    + "function pick(x: Mine): string { return 'mine'; } pick(new Set.<uint8>());")).toBe('protocol');
});

test('a protocol application reflects its protocol as its generic base', () => {
  expect(evaluated('String(Reflect.getReflection.<Reflect.Type>(Iterable.<uint8>).generic.base === Iterable) + String(Reflect.getReflection.<Reflect.Type>(IterableIterator.<uint8>).generic.base === IterableIterator);'))
    .toBe('truetrue');
  expect(evaluated('function f(v: any) { return v is Iterable; } const a: [].<uint8> = [1]; String(f(a)) + String(f({}));')).toBe('truefalse');
});

test('a string is an Iterable of strings', () => {
  expect(evaluated("function h(x: Iterable.<string>): string { let out = ''; for (const c of x) out += c + '.'; return out; } const s: string = 'ab'; h('xy') + h(s);")).toBe('x.y.a.b.');
  refused("function h(x: Iterable.<uint8>) { return 1; } h('ab');", 'rt-assignability');
});

test('a generator reaches a protocol through its structural form', () => {
  // The pinned cases of conformance/generator-lifecycle.json, held here beside
  // the declared relations so that a change to one is seen against the other:
  // a generator's operation result is more precise than the application it
  // would name, so it is compared with the protocol's form, not its arguments.
  refused('function* f(): Generator.<uint8, string, void> { return "done"; } const it: Iterator.<uint8, string, void> = f();', 'rt-assignability');
  expect(observeScript("function* f(): Generator.<uint8, string, void> { return 'done'; } const it: Iterator.<uint8, string | undefined, void> = f(); 'ok';")).toMatchObject({ completion: { Type: 'normal' } });
  refused('function* f(): uint8 {} const it: Iterator.<uint8, undefined, void> = f();', 'rt-assignability');
  expect(observeScript("function* f(): uint8 {} const it: Iterator.<uint8, void, void> = f(); 'ok';")).toMatchObject({ completion: { Type: 'normal' } });
});
