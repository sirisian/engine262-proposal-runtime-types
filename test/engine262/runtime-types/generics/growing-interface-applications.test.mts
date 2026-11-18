import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * A member of a generic interface that applies the interface to another argument
 * (#sec-recursive-interface-resolution, #sec-issubtype).
 *
 * `interface Query<T> { chunk(size: uint32): Query.<[].<T>> }` names a new application at every
 * step: `Query.<[].<T>>`, then `Query.<[].<[].<T>>>`. An interface is nominal, so each of them
 * is a type, a declaration with its arguments, and none of them has to be opened for the first
 * to be one. Forming the first followed the members without a bound and never finished; so did
 * a comparison of two such interfaces, until the host stack gave out.
 */

const early = (rule: string) => ({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
const accepted = (source: string) => expect(observeScript(source).errorClass, source).toBeUndefined();

const Query = 'interface Query<T: type> { first(): T | undefined; chunk(size: uint32): Query.<[].<T>>; window(size: uint32): Query.<[].<T>>; } ';
const ArrayQuery = `class ArrayQuery<T: type> implements Query.<T> {
  items: [].<T>;
  constructor(items: [].<T>) { this.items = items; }
  first(): T | undefined { return this.items[0]; }
  chunk(size: uint32): Query.<[].<T>> {
    const out: [].<[].<T>> = [];
    let run: [].<T> = [];
    let n: uint32 = 0;
    for (const item of this.items) { run.push(item); n += 1; if (n === size) { out.push(run); run = []; n = 0; } }
    if (n > 0) out.push(run);
    return new ArrayQuery.<[].<T>>(out);
  }
  window(size: uint32): Query.<[].<T>> { return this.chunk(size); }
} `;

test('an interface whose members apply it to a growing argument is formed', () => {
  accepted(`${Query}"declared";`);
  accepted(`${Query}function f(q: Query.<uint8>) { return q.chunk(2).chunk(3).window(4).first(); }`);
  // Reached through a base, and from a method's own type parameter.
  accepted(`${Query}interface Group<K: type, T: type> extends Query.<T> { key: K; } function f(g: Group.<string, uint8>) { return g.chunk(2); }`);
  accepted('interface Query<T: type> { zip<U: type, R: type>(other: Iterable.<U>, combine: (left: T, right: U) => R): Query.<R>; chunk(size: uint32): Query.<[].<T>>; } function f(q: Query.<uint8>) { }');
  // Through a property as well as through a result.
  accepted('interface G<T: type> { value: T; deeper: G.<[].<T>> | null; } let g: G.<uint8> | null = null;');
});

test('a class implements it, and its members run at each application', () => {
  const program = `${Query}${ArrayQuery}const q: Query.<uint8> = new ArrayQuery.<uint8>([1, 2, 3, 4, 5]); const c = q.chunk(2); `;
  expect(evaluated(`${program}String(c.first()) + "|" + String(c.chunk(2).first()) + "|" + String(c.chunk(2).chunk(1).first());`)).toBe('1,2|1,2,3,4|1,2,3,4');
  expect(evaluated(`${program}String(Reflect.typeOf(c.first()) === (type [].<uint8>)) + String(c is Query.<[].<uint8>>);`)).toBe('truetrue');
  // Each application is its own type.
  expect(evaluated(`${Query}String((type Query.<uint8>) === (type Query.<uint8>)) + String((type Query.<uint8>) === (type Query.<[].<uint8>>));`)).toBe('truefalse');
  expect(observeScript(`${program}const bad: uint8 | undefined = c.first();`)).toMatchObject(early('rt-assignability'));
  expect(observeScript(`${Query}function f(q: Query.<uint8>) { return 1; } f({ first() { return undefined; }, chunk(n: uint32) { return this; }, window(n: uint32) { return this; } });`))
    .toMatchObject(early('rt-assignability'));
});

test('the applications it names are still checked, the first few of them', () => {
  // The second application has a member that is not a type: a vector of arrays.
  const Q = 'interface Q<T: type> { v: vector.<T, 4> | null; next(): Q.<[].<T>> | null; } ';
  accepted(`${Q}"declared";`);
  expect(observeScript(`${Q}let q: Q.<string> | null = null;`)).toMatchObject(early('rt-vector-argument'));
  expect(observeScript(`${Q}let q: Q.<float32> | null = null;`)).toMatchObject(early('rt-vector-argument'));
  expectThrown(`${Q}let q: Q.<float32> | null = null;`, '[].<float32> is not a valid vector lane type');
  // Applications that come back to an earlier one are followed all the way round.
  accepted('interface Pair<A: type, B: type> { a: A; b: B; swap(): Pair.<B, A>; } let p: Pair.<uint8, string> | null = null;');
  expect(observeScript('interface Pair<A: type, B: type> { v: vector.<A, 4> | null; swap(): Pair.<B, A>; } let p: Pair.<float32, string> | null = null;'))
    .toMatchObject(early('rt-vector-argument'));
  // An application inside a larger one is an argument, however many there are.
  expect(observeScript('interface Box<T: type> { value: T; v: vector.<T, 4> | null; } let b: Box.<Box.<Box.<Box.<Box.<Box.<string>>>>>> | null = null;'))
    .toMatchObject(early('rt-vector-argument'));
});

test('two interfaces that grow alike are not shown to be one another', () => {
  const AB = 'interface A<T: type> { value: T; f(): A.<[].<T>> | null; g(): A.<[].<T>> | null; } interface B<T: type> { value: T; f(): B.<[].<T>> | null; g(): B.<[].<T>> | null; } ';
  expect(observeScript(`${AB}function f(a: A.<uint8>) { const b: B.<uint8> = a; return b; }`)).toMatchObject(early('rt-assignability'));
  // Said with `extends`, the relation needs no comparison of members.
  accepted('interface A<T: type> { value: T; f(): A.<[].<T>> | null; } interface B<T: type> extends A.<T> { extra: T; } function f(b: B.<uint8>) { const a: A.<uint8> = b; return a; }');
  // Two that come back to the same argument are compared as before.
  accepted('interface A<T: type> { value: T; next: A.<T> | null; } interface B<T: type> { value: T; next: B.<T> | null; } function f(a: A.<uint8>) { const b: B.<uint8> = a; return b; }');
});

test('a recursive generic interface at a nullable binding', () => {
  // Each of these exhausted the host stack when the declaration ran.
  const Rec = 'interface Rec<T: type> { x: T; next: Rec.<T> | null; } ';
  const Tree = 'interface Tree<T: type> { value: T; left: Tree.<T> | null; right: Tree.<T> | null; } ';
  expect(evaluated(`${Rec}let r: Rec.<uint8> | null = null; String(r);`)).toBe('null');
  expect(evaluated(`${Rec}let r: Rec.<uint8> | null = null; r = { x: 1, next: { x: 2, next: null } }; String(r.next?.x);`)).toBe('2');
  expect(evaluated(`${Tree}let t: Tree.<uint8> | null = { value: 1, left: null, right: { value: 2, left: null, right: null } };
    function size(n: Tree.<uint8> | null): uint32 { return n === null ? 0 : 1 + size(n.left) + size(n.right); } String(size(t));`)).toBe('2');
  expectThrown(`${Tree}function mk(v) { return { value: 1, left: null, right: { value: v, left: null, right: null } }; } let t: Tree.<uint8> | null = mk("x");`, 'is not assignable to');
  // A member that grows is entered a bounded number of times, and the value decides the rest.
  const G = 'interface G<T: type> { value: T; deeper: G.<[].<T>> | null; } ';
  expect(evaluated(`${G}let g: G.<uint8> | null = { value: 1, deeper: { value: [2], deeper: null } }; String(g.deeper?.value[0]);`)).toBe('2');
  expectThrown(`${G}function mk(v) { return { value: 1, deeper: { value: v, deeper: null } }; } let g: G.<uint8> | null = mk(2);`, 'is not assignable to');
});

test('a generic class implements an interface that names itself at the class parameter', () => {
  // The member's `Seq.<T>` was compared unbound, as `Seq.<T>` against `Seq.<uint8>`.
  const Seq = 'interface Seq<T: type> { first(): T | undefined; same(): Seq.<T>; } ';
  const ArraySeq = 'class ArraySeq<T: type> implements Seq.<T> { items: [].<T>; constructor(items: [].<T>) { this.items = items; } first(): T | undefined { return this.items[0]; } same(): Seq.<T> { return this; } } ';
  expect(evaluated(`${Seq}${ArraySeq}const q: Seq.<uint8> = new ArraySeq.<uint8>([1, 2, 3]); String(q.same().first());`)).toBe('1');
  expect(evaluated(`${Seq}${ArraySeq}const q: Seq.<string> = new ArraySeq.<string>(["a"]); String(q.same().same().first());`)).toBe('a');
  expect(observeScript(`${Seq}class Bad<T: type> implements Seq.<T> { first(): T | undefined { return undefined; } same(): Seq.<string> { throw new Error("no"); } }`))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a generic class whose members apply it to a growing argument is built', () => {
  // Declaring one was accepted; `new Q.<uint8>()` and `let q: Q.<uint8> | null = null` never
  // returned. Building `Q.<uint8>` evaluated its body, whose `Q.<[].<uint8>>` was built to
  // evaluate that, and so on.
  const Q = `class Q<T: type> {
    items: [].<T>;
    constructor(items: [].<T>) { this.items = items; }
    first(): T | undefined { return this.items[0]; }
    chunk(): Q.<[].<T>> { const out: [].<[].<T>> = []; out.push(this.items); return new Q.<[].<T>>(out); }
  } `;
  expect(evaluated('class Q<T: type> { chunk(): Q.<[].<T>> | null { return null; } } const q = new Q.<uint8>(); String(q.chunk());')).toBe('null');
  expect(evaluated('class Q<T: type> { v: T | null = null; chunk(): Q.<[].<T>> | null { return null; } } let q: Q.<uint8> | null = null; String(q);')).toBe('null');
  expect(evaluated('class Q<T: type> { v: T | null = null; deeper: Q.<[].<T>> | null = null; } const q = new Q.<uint8>(); String(q.deeper);')).toBe('null');
  // Past the depth that is built ahead, an application is built where it is constructed,
  // and it is the type its declaration and arguments say.
  const deep = 'Q.<[].<[].<[].<[].<[].<[].<[].<uint8>>>>>>>>';
  expect(evaluated(`${Q}const d = new Q.<uint8>([1, 2]).chunk().chunk().chunk().chunk().chunk().chunk().chunk();
    String(d.first()) + "|" + String(d is ${deep}) + String(d is Q.<uint8>);`)).toBe('1,2|truefalse');
  expect(evaluated(`${Q}const a: Q.<[].<[].<[].<[].<[].<uint8>>>>>> = new Q.<uint8>([1, 2]).chunk().chunk().chunk().chunk().chunk();
    const b: Q.<[].<[].<[].<[].<[].<[].<uint8>>>>>>> = a.chunk(); String(b.items[0][0][0][0][0][0][1]);`)).toBe('2');
  expect(evaluated(`class Q<T: type> { chunk(): Q.<[].<T>> | null { return null; } }
    const x = new ${deep}(); const y = new ${deep}();
    String(Reflect.typeOf(x) === Reflect.typeOf(y)) + String(x.constructor === y.constructor) + String(Reflect.typeOf(x) === (type Q.<uint8>));`)).toBe('truetruefalse');
  // A member's result is still held to the application it declares, at any depth.
  expect(observeScript(`${Q.replace('return new Q.<[].<T>>(out);', 'return this;')}`)).toMatchObject(early('rt-assignability'));
  expectThrown(`${Q.replace('return new Q.<[].<T>>(out);', 'const x: any = this; return x;')}
    new Q.<uint8>([1, 2]).chunk();`, 'is not assignable to');
  // Two classes that grow through one another, and a value class.
  expect(evaluated('class A<T: type> { b(): B.<[].<T>> | null { return null; } } class B<T: type> { a(): A.<[].<T>> | null { return null; } } String(new A.<uint8>().b());')).toBe('null');
  expect(evaluated('value class P<T: type> { n: uint8 = 3; wrap(): P.<[].<T>> { return new P.<[].<T>>(); } } String(new P.<uint8>().wrap().wrap().wrap().wrap().wrap().wrap().n);')).toBe('3');
});
