import { test, expect } from 'vitest';
import { evaluated, expectThrown, expectThrownFlagOff } from '../harness.mts';

/**
 * Spec: #sec-array-and-tuple-types (Array and Tuple Types), #sec-issubtype.
 *
 * `[].<any>` is the top of the array family.
 *
 * Arrays are invariant in their element, so without a top an array whose
 * element type is written `any` is a type nothing inhabits - no array is
 * declared that way - and the bound the design writes over the family,
 * `T extends []`, is satisfied by nothing at all. `any` is already the type of which every
 * value is a value; this is that reading carried to the array types.
 *
 * What makes it admissible where a general covariance would not be is that a
 * store to an element is checked against the ARRAY's own element type at run
 * time, so a write through the wider view is refused whatever the static type
 * permitted - the last test below. A language with invariant containers and
 * unchecked elements supplies a wildcard and forbids writing through it.
 */

test('every array and tuple satisfies the array-family bound', () => {
  const G = "function g<T extends []>(v: T): string { return 'ok'; } ";
  expect(evaluated(`${G}const a: [].<number> = [1]; g(a);`)).toBe('ok');
  expect(evaluated(`${G}const a: [4].<uint8> = [1, 2, 3, 4]; g(a);`)).toBe('ok');
  expect(evaluated(`${G}const t: [number, string] = [1, 'a']; g(t);`)).toBe('ok');
  expect(evaluated(`${G}g([1, 'a']);`)).toBe('ok');
  // the other spelling the design documents use
  expect(evaluated("function g<T extends [].<any>>(v: T): string { return 'ok'; }"
    + ' const a: [].<number> = [1]; g(a);')).toBe('ok');
});

test('an ordinary parameter of the top type accepts them too', () => {
  const P = "function p(v: [].<any>): string { return 'ok'; } ";
  expect(evaluated(`${P}const a: [].<number> = [1]; p(a);`)).toBe('ok');
  expect(evaluated(`${P}const a: [4].<uint8> = [1, 2, 3, 4]; p(a);`)).toBe('ok');
  expect(evaluated('const a: [].<uint8> = [1]; const b: [].<any> = a; String(b.length);')).toBe('1');
  // a value that is not an array is still refused
  expectThrown(`${P}p({ a: 1 });`);
});

test('element invariance and the extent rules are unchanged', () => {
  // the rule the clause gives its reason for: a uint8 array is not a number array
  expectThrown('const a: [].<uint8> = [1]; const b: [].<number> = a;');
  // a fixed target still fixes the length, and takes any element type within it
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; const b: [4].<any> = a; String(b.length);')).toBe('4');
  expectThrown('const a: [].<uint8> = [1]; const b: [4].<any> = a;');
});

test('a store through the wider view is still checked', () => {
  // this is what takes the place of a wildcard's prohibition on writing
  expect(evaluated('const a: [].<uint8> = [1]; const b: [].<any> = a;'
    + " function big() { return 300; }"
    + " try { b[0] = big(); 'no'; } catch (e) { e.constructor.name; }")).toBe('RangeError');
  // and a value the element type does admit still stores
  expect(evaluated('const a: [].<uint8> = [1]; const b: [].<any> = a;'
    + ' function ok() { return 200; } b[0] = ok(); String(a[0]);')).toBe('200');
});

test('the bound composes with the rest of the array work', () => {
  // a parameter bound by the family may be indexed and measured
  expect(evaluated("function g<T extends []>(v: T) { return v[0]; }"
    + ' const a: [].<uint8> = [7]; String(g(a));')).toBe('7');
  expect(evaluated('function g<T extends []>(v: T) { return v.length; }'
    + " const t: [number, string] = [1, 'a']; String(g(t));")).toBe('2');
  // a borrow taken through the wider view writes the original
  expect(evaluated('const a: [].<uint8> = [1]; const b: [].<any> = a;'
    + ' let ref r = b[0]; r = 5; String(a[0]);')).toBe('5');
  // and a borrow into a fixed-extent array still writes it
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; let ref b = a[0]; b = 9; String(a[0]);')).toBe('9');
  // an SoA is not an array and is still refused, as soa.md requires
  expect(evaluated('class P { x: uint8; } const s = new SoA.<P>();'
    + " function p(v: [].<any>): string { return 'ok'; }"
    + " try { p(s); 'no'; } catch (e) { e.constructor.name; }")).toBe('TypeError');
});

// -- An Array's runtime type -----------------------------------------------------

/*
 * An Array's runtime type is an ~array~ type (#sec-runtimetypeof).
 *
 * Membership walks a value's length and elements, so `['a'] is [].<string>` is
 * true - but everything that RANKS types instead of walking values read the
 * ~object~ type describing the indices as properties, which no array type
 * relates to. Overload resolution was the visible case: with `f(x: [].<int32>)`
 * and `f(s: [].<string>)` declared, no argument could select either, however it
 * was written.
 */

const OV = "function f(x: [].<int32>): string { return 'int32'; }"
  + " function f(s: [].<string>): string { return 'string'; } ";

test('an overload may be selected by an array element type', () => {
  expect(evaluated(`${OV}f(['test']);`)).toBe('string');
  expect(evaluated(`${OV}const a: [].<int32> = [(1 := int32)]; f(a);`)).toBe('int32');
  // a declared array argument selects the same overload its contents would
  expect(evaluated(`${OV}const a: [].<string> = ['test']; f(a);`)).toBe('string');
  // and an argument matching neither is still refused
  expectThrown(`${OV}f([true]);`);
});

test('the runtime type agrees with membership', () => {
  expect(evaluated("String(['test'] is [].<string>);")).toBe('true');
  expect(evaluated("String(['test'] is [].<int32>);")).toBe('false');
  // a typed array reports the type it carries, so two of one type are one type
  expect(evaluated('const a: [].<uint8> = [1]; const b: [].<uint8> = [2];'
    + ' String(Reflect.typeOf(a) === Reflect.typeOf(b));')).toBe('true');
  // and an untyped array of numbers is not the same type as a `[].<uint8>`
  expect(evaluated('const a: [].<uint8> = [1]; String(Reflect.typeOf(a) === Reflect.typeOf([1]));')).toBe('false');
});

test('an element type is inferred from an array argument', () => {
  expect(evaluated("function g<T>(v: [].<T>): string { let x: T = 'z'; return x; } g(['a']);")).toBe('z');
  expect(evaluated('function g<T>(v: [].<T>): T { return v[0]; } String(g([(1 := int32)]));')).toBe('1');
});

test('mixed, nested, and non-array values are unaffected', () => {
  expect(evaluated("function m(v: [].<number | string>): string { return 'ok'; } m([1, 'a']);")).toBe('ok');
  expect(evaluated("function n(v: [].<[].<uint8>>): string { return 'ok'; }"
    + ' const inner: [].<uint8> = [1]; n([inner]);')).toBe('ok');
  // an ordinary object still reports an object type
  expect(evaluated('String(Reflect.typeOf({ a: 1 }) === Reflect.typeOf({ a: 2 }));')).toBe('true');
  // and a single signature and scalar overloads behave as before
  expect(evaluated("function g(s: [].<string>): string { return 'ok'; } g(['test']);")).toBe('ok');
  expect(evaluated("function h(x: int32): string { return 'int32'; }"
    + " function h(s: string): string { return 'string'; } h('t');")).toBe('string');
});

test('the runtime type handles the awkward array shapes', () => {
  // a hole contributes nothing a type could name, and a cycle must not recurse
  expect(evaluated("function p(v: [].<any>): string { return 'ok'; } const s = [1, , 3]; p(s);")).toBe('ok');
  expect(evaluated("function p(v: [].<any>): string { return 'ok'; }"
    + ' const s = [1]; s.push(s); p(s);')).toBe('ok');
  // a nested typed array is described through its element
  expect(evaluated('const inner: [].<uint8> = [1]; const outer = [inner];'
    + ' String(outer is [].<[].<uint8>>);')).toBe('true');
  // the extent is part of the reported type
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; const b: [4].<uint8> = [5, 6, 7, 8];'
    + ' String(Reflect.typeOf(a) === Reflect.typeOf(b));')).toBe('true');
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; const d: [].<uint8> = [1];'
    + ' String(Reflect.typeOf(a) === Reflect.typeOf(d));')).toBe('false');
});

// -- An array type in expression position ----------------------------------------

/*
 * An array type written where an EXPRESSION is expected
 * (#sec-array-and-tuple-types).
 *
 * `new [100].<uint8>()` constructs one and `class G extends [16].<uint8> { }`
 * derives from one - both forms the design writes (README "Multidimensional and
 * Jagged Array Support Via User-defined Index Operators", and the view form
 * beside it). The bracketed text is an array LITERAL where an expression is
 * expected, so before this the type arguments were evaluated and discarded and
 * both forms reported "[object Array] is not a constructor".
 *
 * An instance is an Array carrying its element type, which is what a typed
 * array is everywhere else here: the element store check, `length`, and the
 * methods of Array.prototype all apply to one without a second kind of object.
 */

test('an array type constructs', () => {
  // a fixed extent has that many elements, each the element type's default
  expect(evaluated('const a = new [4].<uint8>(); String(a.length);')).toBe('4');
  expect(evaluated('const a = new [4].<uint8>(); String(a[0]);')).toBe('0');
  expect(evaluated('const a = new [100].<uint8>(); String(a.length);')).toBe('100');
  // a dynamic one starts empty and grows
  expect(evaluated('const a = new [].<uint8>(); a.push(1); a.push(2); String(a.length);')).toBe('2');
  expect(evaluated('const a = new [].<uint8>(); String(a.length);')).toBe('0');
});

test('an instance carries its element type', () => {
  expect(evaluated('const a = new [4].<uint8>(); a[0] = 200; String(a[0]);')).toBe('200');
  // the store check reads the element type off the array
  expectThrown('const a = new [4].<uint8>(); a[0] = 300;');
  expect(evaluated('const a = new [4].<uint8>(); String(Array.isArray(a));')).toBe('true');
});

test('a class may derive from an array type', () => {
  expect(evaluated('class C extends [4].<uint8> {} const c = new C(); String(c.length);')).toBe('4');
  expect(evaluated('class C extends [4].<uint8> {} const c = new C();'
    + ' String(Array.isArray(c)) + "," + String(c instanceof C);')).toBe('true,true');
  // the subclass's own methods are reachable
  expect(evaluated('class C extends [4].<uint8> { first() { return this[0]; } }'
    + ' const c = new C(); c[0] = 7; String(c.first());')).toBe('7');
  // and so are the inherited array methods
  expect(evaluated('class C extends [4].<uint8> {} const c = new C(); c[0] = 3;'
    + ' String(c.map((v) => Number(v) * 2)[0]);')).toBe('6');
  // an element store through the subclass is checked the same way
  expectThrown('class C extends [4].<uint8> {} const c = new C(); c[0] = 300;');
  // a dynamic extent derives too
  expect(evaluated('class C extends [].<uint8> {} const c = new C(); c.push(1); String(c.length);')).toBe('1');
});

test('an array type denotes one constructor', () => {
  // the types are interned, and the constructor is the type's
  expect(evaluated('String(([4].<uint8>) === ([4].<uint8>));')).toBe('true');
  expect(evaluated('String(([4].<uint8>) === ([8].<uint8>));')).toBe('false');
  expect(evaluated('String(([4].<uint8>) === ([4].<uint16>));')).toBe('false');
});

test('an array type constructor requires new', () => {
  expectThrown('([4].<uint8>)();');
});

test('the annotation form is unaffected', () => {
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; String(a.length);')).toBe('4');
  expect(evaluated('const a: [].<uint8> = [1]; a.push(2); String(a.length);')).toBe('2');
});

test('an ordinary array literal is untouched', () => {
  expect(evaluated('const a = [4]; String(a.length) + "," + String(a[0]);')).toBe('1,4');
  expect(evaluated('const a = []; a.push(1); String(a.length);')).toBe('1');
});

test('the design\'s grid shape composes with the index accessor forms', () => {
  // an array-typed base, a two-index accessor, and a `ref` read direction
  // serving the write - the design's GridArray without its generic parameters
  expect(evaluated('class G extends [16].<uint8> {'
    + ' get operator[](x: uint32, y: uint32) { return ref this[y * 4 + x]; } }'
    + ' const g = new G(); g[2, 1] = 10; String(g[2, 1]);')).toBe('10');
  expect(evaluated('class G extends [16].<uint8> {'
    + ' get operator[](x: uint32, y: uint32) { return ref this[y * 4 + x]; } }'
    + ' const g = new G(); g[2, 1] = 10; String(g[6]);')).toBe('10');
});

test('an array type in expression position is inert with the feature off', () => {
  expectThrownFlagOff('new [4].<uint8>();');
});

// -- Stores to a tuple position (#sec-array-defaults-and-stores) ---------------
//
// "A store to an element of an array of element type _t_ checks the value
// against _t_." A tuple has a type PER POSITION rather than one element type,
// and its positions were checked when it was built and never again.

test('a store to a tuple position is checked against THAT position', () => {
  expectThrown('type T = [uint8, string]; let t: T = [1, "s"]; t[0] = "wrong";');
  // A store into a `string` position CONVERTS a numeric rather than refusing it,
  // which is what the array element store does too - RequireType converts, and
  // #sec-the-conversion-rule says a primitive is assignable only to itself and
  // `any`. Pinned here as the tuple's, and recorded against the shared cause in
  // KNOWN-DIVERGENCES.md rather than fixed by this rule.
  expect(evaluated('type T = [uint8, string]; let t: T = [1, "s"];'
    + ' t[1] = (1 := uint8); `${t[1]}:${typeof t[1]}`;')).toBe('1:string');
  // The legitimate stores still work, each at its own type.
  expect(evaluated('type T = [uint8, string]; let t: T = [1, "s"];'
    + ' t[0] = (9 := uint8); t[1] = "ok"; `${t[0]}:${t[1]}`;')).toBe('9:ok');
});

test('a tuple keeps its arity', () => {
  // The arity is part of the type, so there is no position to grow into.
  expectThrown('type T = [uint8, string]; let t: T = [1, "s"]; t.push(99);');
  expectThrown('type T = [uint8]; let t: T = [1]; t[1] = (2 := uint8);');
  // Unless a rest element admits the position, which is what a rest is for.
  expect(evaluated('type R = [uint8, ...[].<string>]; let r: R = [1, "a"];'
    + ' r[2] = "c"; r.push("d"); `${r.length}:${r[3]}`;')).toBe('4:d');
  // Same conversion as above; what matters here is that the REST position's type
  // is the one consulted.
  expect(evaluated('type R = [uint8, ...[].<string>]; let r: R = [1, "a"];'
    + ' r[2] = (5 := uint8); typeof r[2];')).toBe('string');
});

test('the covariance of a tuple is closed at the store', () => {
  // #sec-issubtype makes a tuple covariant position-wise, so a narrow tuple may
  // be seen as a wider one - and the boundary between them may be elided, which
  // leaves the two views as ONE object. Only a mark on the object can refuse a
  // store the narrow view forbids, and this is that store: before this rule, the
  // String landed in a slot declared uint8 and was readable through `narrow`.
  expectThrown('type TupN = [uint8]; type TupW = [uint8 | string];'
    + ' let narrow: TupN = [1]; let wide: TupW = narrow; wide[0] = "a string";');
  // And the check answers the array's own type however the write arrives.
  expectThrown('type T = [uint8]; let t: T = [1]; let loose: any = t; loose[0] = "a string";');
});

test('the rule reaches a tuple wherever it is held', () => {
  expectThrown('class H { t: [uint8, string] = [1, "s"]; } const h = new H(); h.t[0] = "wrong";');
  expectThrown('type O = { t: [uint8, string] }; let o: O = { t: [1, "s"] }; o.t[0] = "wrong";');
});

test('a defaulted trailing position is unaffected', () => {
  expect(evaluated('type D = [uint8, uint8 = 5]; let d: D = [1]; `${d.length}:${d[1]}`;')).toBe('2:5');
});
