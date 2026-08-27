import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * PLAN-static-signatures.md phase 1 - `Map.groupBy`.
 *
 * `standardlibrary.md` states four typed signatures for the standard library's
 * generic statics and calls them "signature listings rather than new features:
 * every method here already exists, and the signatures state how element and key
 * types flow through, so fully typed call sites infer their callbacks and
 * engines can specialize the loops."
 *
 *     function Map.groupBy<K, T>(
 *         items: Iterable.<T>,
 *         callback: (value: T, index: uint32) => K
 *     ): Map.<K, [].<T>>;
 *
 * NONE of the four were typed, and this is the first. An instance method is
 * found through its RECEIVER's type; a static has no typed receiver, since
 * `Reflect.typeOf(Map)` is not `Map`. So it is dispatched BY NAME, which is the
 * mechanism `Composite(…)` and `uint8.parse` already use.
 *
 * Every assertion is written BOTH WAYS. A refusal alone proves that something
 * was checked, never that the right thing was inferred - a survey of this area
 * once read six capabilities as working on the strength of refusals, and four of
 * them refused every annotation.
 */

const A = 'const a: [].<uint32> = [1, 2, 1]; ';

test('the result carries the key type and the grouped element type', () => {
  expect(ok(`${A} let g: Map.<string, [].<uint32>> = Map.groupBy(a, (n) => "k");`)).toBe(true);
  expectStaticTypeError(`${A} let g: Map.<uint8, [].<uint32>> = Map.groupBy(a, (n) => "k");`);
  expectStaticTypeError(`${A} let g: Map.<string, [].<string>> = Map.groupBy(a, (n) => "k");`);
  expectStaticTypeError(`${A} let g: uint8 = Map.groupBy(a, (n) => "k");`);
});

test('the callback\'s parameter is typed from the source, which is the point', () => {
  // "so fully typed call sites infer their callbacks" - the design's own reason
  // for stating these signatures at all.
  expect(ok(`${A} Map.groupBy(a, (n) => { let s: uint32 = n; return "k"; });`)).toBe(true);
  expectStaticTypeError(`${A} Map.groupBy(a, (n) => { let s: string = n; return "k"; });`);
  // A BLOCK-bodied callback binds its key type as a concise one does, which
  // needed the whole of Phase 0 to be true.
  expect(ok(`${A} let g: Map.<string, [].<uint32>> = Map.groupBy(a, (n) => { return "k"; });`)).toBe(true);
  expectStaticTypeError(`${A} let g: Map.<uint8, [].<uint32>> = Map.groupBy(a, (n) => { return "k"; });`);
});

test('the key type comes from the callback, including a COMPOSITE key', () => {
  // The idiom `composites.md` names for grouping on more than one field, and the
  // one that gets nothing from an untyped `groupBy`.
  expect(evaluated('const g = Map.groupBy([1, 2, 1], (n) => Composite({ v: n })); String(g.size);')).toBe('2');
  expect(evaluated('const g = Map.groupBy([1, 2, 1], (n) => Composite({ v: n })); String(g.get(Composite({ v: 1 })).length);')).toBe('2');
});

test('a SHADOWED `Map` gets no signature', () => {
  // A constructor is a value a program may replace, and the builtin's signature
  // must not follow the name. This is the guard the plan's risk section asks to
  // be asserted before anything else.
  // Guarded, so what is asserted is the STATIC answer: the shadowed `Map` has no
  // `groupBy` at run time and would throw for a reason that has nothing to do
  // with the signature.
  expect(ok(`if (false) { class M2 { } const Map = M2; ${A} let g: uint8 = Map.groupBy(a, (n) => "k"); } 1;`)).toBe(true);
});

test('an UNTYPED source yields an untyped result, per participation', () => {
  // sec 0: a program that does not use these types pays nothing. Where the
  // element type is unknown the result carries none rather than a half-built
  // `Map.<any, …>`, which would state more than the call supports.
  // Guarded for the same reason: a `uint8` annotation is refused at RUN TIME by
  // the boundary, and what this asserts is that the CHECKER says nothing.
  expect(ok('if (false) { const u = [1, 2]; let g: uint8 = Map.groupBy(u, (n) => "k"); } 1;')).toBe(true);
  expect(evaluated('const g = Map.groupBy([1, 2], (n) => "k"); String(g.size);')).toBe('1');
});

test('the run time is unchanged in every case', () => {
  expect(evaluated('const g = Map.groupBy([1, 2, 1], (n) => n); String(g.size);')).toBe('2');
  expect(evaluated('const g = Map.groupBy([1, 2, 1], (n) => n); String(g.get(1).length);')).toBe('2');
  expect(evaluated('const g = Map.groupBy([], (n) => "k"); String(g.size);')).toBe('0');
  expect(evaluated('const o = Object.groupBy([1, 2], (n) => "k"); String(Object.keys(o).length);')).toBe('1');
});

// ---------------------------------------------------------------------------
// Object.groupBy - phase 2
// ---------------------------------------------------------------------------

test('Object.groupBy publishes an index-signature result', () => {
  // `standardlibrary.md`: "function Object.groupBy<K extends string | symbol, T>(
  // items, callback): { [key: K]: [].<T> }".
  expect(ok(`${A} let o: { [key: string]: [].<uint32> } = Object.groupBy(a, (n) => "k");`)).toBe(true);
  expectStaticTypeError(`${A} let o: uint8 = Object.groupBy(a, (n) => "k");`);
  // The callback's parameter is typed from the source, as `Map.groupBy`'s is.
  expect(ok(`${A} Object.groupBy(a, (n) => { let s: uint32 = n; return "k"; });`)).toBe(true);
  expectStaticTypeError(`${A} Object.groupBy(a, (n) => { let s: string = n; return "k"; });`);
});

test('Object.groupBy constrains its key where Map.groupBy does not', () => {
  // The design's stated contrast: "Object.groupBy produces PROPERTY KEYS, so its
  // key type is constrained to the property key types; Map.groupBy accepts any
  // key type, using SameValueZero like Map itself."
  //
  // A key that is not a property key states nothing here, so the result carries
  // no type rather than an index signature no property could satisfy - and the
  // whole-result annotation is then unchecked, which is what the first assertion
  // records.
  // Guarded: these assert the CHECKER's answer, and both would meet a run-time
  // boundary that has nothing to do with the signature.
  expect(ok(`if (false) { ${A} let o: uint8 = Object.groupBy(a, (n) => (1 := uint8)); } 1;`)).toBe(true);
  // The same non-property key IS a key for `Map.groupBy`, which is the contrast.
  expect(ok(`if (false) { ${A} let g: Map.<uint8, [].<uint32>> = Map.groupBy(a, (n) => (1 := uint8)); } 1;`)).toBe(true);
  expectStaticTypeError(`${A} let g: Map.<string, [].<uint32>> = Map.groupBy(a, (n) => (1 := uint8));`);
});

test.fails('OQ17: an index signature does not participate in assignability', () => {
  // `{ [key: string]: [].<string> }` is accepted for a result whose value type is
  // `[].<uint32>`. PRE-EXISTING and general, not something these signatures
  // introduce: two HAND-WRITTEN index-signature types are mutually assignable
  // whatever their value types, and a member read through one is unchecked.
  //
  // The plan shipped `Object.groupBy` anyway (OQ17 direction B): the signature is
  // not wrong, only unenforced at that depth, and the whole-result check - which
  // is the common mistake - does work. Filed here so that fixing index
  // signatures converts this with it.
  expectStaticTypeError(`${A} let o: { [key: string]: [].<string> } = Object.groupBy(a, (n) => "k");`);
  expectStaticTypeError('function f(x: { [key: string]: uint8 }) {} let y: { [key: string]: string } = {}; f(y);');
  expectStaticTypeError('let y: { [key: string]: uint8 } = {}; let s: string = y.a;');
});

// ---------------------------------------------------------------------------
// Phase 4 - the cases the plan's list did not name
// ---------------------------------------------------------------------------

test('the items may be any ITERABLE, not only an array', () => {
  // The signature's first parameter is `Iterable.<T>`, so `T` is recovered
  // through the interface rather than off an array's [[Element]]. A collection
  // reaches it by the `Iterable` it DECLARES, which is what makes this test
  // about the signature and not about arrays.
  const S = 'let s: Set.<uint32> = new Set(); ';
  expect(ok(`${S} let g: Map.<string, [].<uint32>> = Map.groupBy(s, (n) => "k");`)).toBe(true);
  expectStaticTypeError(`${S} let g: Map.<string, [].<string>> = Map.groupBy(s, (n) => "k");`);
  // ...and the callback's parameter is typed from the collection's element.
  expect(ok(`${S} Map.groupBy(s, (n) => { let x: uint32 = n; return "k"; });`)).toBe(true);
  expectStaticTypeError(`${S} Map.groupBy(s, (n) => { let x: string = n; return "k"; });`);
});

test('the callback\'s INDEX parameter is the index type', () => {
  // `#index-type`: one type describes every count a container reports or
  // accepts, "an index used to read or write an element" among them. A
  // callback's index is such a count, so it is `uint64`.
  //
  // `standardlibrary.md` writes `uint32` for it, which predates that dfn;
  // `sec-typed-standard-library-statics` states `uint64` and the design is the
  // side that should move.
  expect(ok(`${A} Map.groupBy(a, (n, i) => { let x: uint64 = i; return "k"; });`)).toBe(true);
  expectStaticTypeError(`${A} Map.groupBy(a, (n, i) => { let x: string = i; return "k"; });`);
});

test('a shadowed `Object` gets no signature either', () => {
  // The guard is on the base being an unshadowed global, and it is asserted for
  // both statics rather than only the first - a guard tested on one name is a
  // guard that may be keyed on that name.
  expect(ok(`if (false) { class O2 { } const Object = O2; ${A} let o: uint8 = Object.groupBy(a, (n) => "k"); } 1;`)).toBe(true);
});

test('D25: an ANNOTATED result is stamped, the elision no longer skipping adoption', () => {
  // `Map.groupBy` publishes `Map.<K, [].<T>>` while the value it returns carries
  // no type arguments. #sec-collection-construction has an unstamped collection
  // ADOPT the target's at a boundary - and the boundary was being ELIDED,
  // because Phase 1 gave the call a Static Type and the checker could then prove
  // the initializer satisfied its annotation.
  //
  // The elision is right for a CHECK, which cannot fail where the type is
  // proven, and wrong for ADOPTION, which is not a no-op. `conversionHasEffect`
  // now says so, as it already did for `Span`.
  expect(evaluated(`${A} let g: Map.<string, [].<uint32>> = Map.groupBy(a, (n) => "k"); String(Reflect.typeOf(g.size) === (type uint64));`)).toBe('true');
  expect(evaluated(`${A} let g: Map.<string, [].<uint32>> = Map.groupBy(a, (n) => "k"); String(g is Map.<string, [].<uint32>>);`)).toBe('true');
  // The adoption still CHECKS: a collection whose contents deny the type is
  // refused rather than re-labelled.
  expect(evaluated('const u = new Map(); u.set("a", "b"); try { let m: Map.<string, uint8> = u; "no"; } catch (e) { "caught"; }')).toBe('caught');
});

test('a BARE call is not stamped, and that is correct', () => {
  // No annotation means no boundary, and adoption happens AT a boundary. So
  // `const g = Map.groupBy(...)` has the Static Type `Map.<K, [].<T>>` and a
  // value carrying no arguments - the static and run-time halves describing the
  // same collection differently.
  //
  // Not unsound: `g.size` is a Number, and a Number reaching a `uint64` position
  // converts. Whether a static-only claim should exist at all is the open half
  // of D25, and it is a question about the SIGNATURE rather than about the
  // elision that this fixed.
  expect(evaluated(`${A} const g = Map.groupBy(a, (n) => "k"); String(typeof g.size);`)).toBe('number');
  expect(evaluated(`${A} const g = Map.groupBy(a, (n) => "k"); String(g.get("k").length);`)).toBe('3');
});

// ---------------------------------------------------------------------------
// Group A - statics whose result depends on nothing the call passes
// ---------------------------------------------------------------------------

test('a fixed-result static states what it returns', () => {
  // Not overloading. #sec-overloading-of-the-standard-library covers every
  // function that TAKES a numeric-typed value and says one "that merely returns
  // a number, with no parameter whose type could select a signature, is not
  // overloaded and is unchanged". Unchanged is about which SIGNATURE a call
  // selects; it does not say the call has no Static Type, and these had none -
  // `Array.isArray([1])` was ~any~.
  expectStaticTypeError('let n: string = Array.isArray([1]);');
  expect(ok('let n: boolean = Array.isArray([1]);')).toBe(true);
  // The four `Number` predicates are NOT here. They are overloaded
  // (#sec-overloading-of-the-standard-library names them), and
  // `table-numeric-library-signatures` gives them LITERAL results per family -
  // `Number.isNaN` over an integer answers *false*. A fixed `boolean` displaced
  // that and refused `let n: false = Number.isNaN(x)`, which the table says
  // holds. A fixed result must never displace an overload.
  expect(ok('const x: uint8 = 1; let n: false = Number.isNaN(x);')).toBe(true);
  expect(ok('const x: uint8 = 1; let n: true = Number.isInteger(x);')).toBe(true);
  // The global spelling agrees, which is what said the two had diverged.
  expect(ok('const x: uint8 = 1; let n: false = isNaN(x);')).toBe(true);
  expectStaticTypeError('let n: string = Object.is(1, 1);');
  expectStaticTypeError('let n: uint8 = Symbol.for("x");');
  expect(ok('let n: symbol = Symbol.for("x");')).toBe(true);
  expectStaticTypeError('let n: string = Date.now();');
  expect(ok('let n: number = Date.now();')).toBe(true);
  expectStaticTypeError('let n: uint8 = String.fromCharCode(65);');
  expect(ok('let n: string = String.fromCharCode(65);')).toBe(true);
});

test('Math and the numeric library are untouched by this group', () => {
  // They were already done, in the specification AND the engine, and a draft of
  // the plan misread them as this group's headline. `Math.sqrt` over a numeric
  // type answers that type; over a Number it is unchanged, which is the clause's
  // own rule and what the misreading measured.
  expect(ok('const x: float32 = 4; let n: float32 = Math.sqrt(x);')).toBe(true);
  expectStaticTypeError('const x: float32 = 4; let n: string = Math.sqrt(x);');
  expect(evaluated('const x: float32 = 4; String(Reflect.typeOf(Math.sqrt(x)) === (type float32));')).toBe('true');
  // The quantity-parameter rule, also already in place.
  expect(evaluated('const t: uint32 = 3; String(Array(t).length);')).toBe('3');
});

test('a shadowed base gets no fixed result either, and the run time is unchanged', () => {
  expect(ok('if (false) { class A2 { } const Array = A2; let n: string = Array.isArray([1]); } 1;')).toBe(true);
  expect(evaluated('String(Array.isArray([1])) + String(Number.isInteger(1)) + String(Object.is(1, 1));')).toBe('truetruetrue');
});

test.fails('a TAGGED TEMPLATE does not reach the static dispatch', () => {
  // `String.raw({ raw: [...] })` is typed and `` String.raw`x` `` is not: a
  // tagged template is a different node from a call, so the dispatch - which
  // matches a member CALLEE - never sees it. Every tagged builtin is in the same
  // position, which is why this is filed rather than special-cased for `raw`.
  expectStaticTypeError('let n: uint8 = String.raw`x`;');
});

// ---------------------------------------------------------------------------
// Family B - global functions
// ---------------------------------------------------------------------------

test('a global function states what it returns', () => {
  // The same rule as the fixed statics, for a callee that is a bare identifier
  // rather than a member. `Composite(…)` is the precedent for keying on one.
  expectStaticTypeError('let n: string = parseInt("1");');
  expect(ok('let n: number = parseInt("1");')).toBe(true);
  expectStaticTypeError('let n: string = parseFloat("1");');
  expect(ok('let n: number = parseFloat("1");')).toBe(true);
  for (const f of ['encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent']) {
    expectStaticTypeError(`let n: uint8 = ${f}("a");`);
    expect(ok(`let n: string = ${f}("a");`), f).toBe(true);
  }
});

test('the OVERLOADED globals are left alone', () => {
  // #sec-overloading-of-the-standard-library names `isFinite` and `isNaN` among
  // the functions overloaded for the numeric types, and
  // `table-numeric-library-signatures` gives them literal results per family. A
  // fixed `boolean` would displace an overload - the mistake made once with
  // `Math.*` and again with the `Number` predicates.
  expect(ok('let n: string = isNaN(1);')).toBe(true);
  expect(ok('let n: string = isFinite(1);')).toBe(true);
  // `eval` has no type to claim, and is not given one.
  expect(ok('let n: uint8 = eval("1");')).toBe(true);
});

test('a global that this engine does not implement gets no signature', () => {
  // `escape` and `unescape` are Annex B and absent here - `escape("a")` throws.
  // A Static Type for one would claim something no call can reach, so a program
  // written against it would type-check and then fail. Both were in a draft of
  // the table and were removed when the run time was checked.
  //
  // The call is refused, but for the ORDINARY reason - `escape` is not defined -
  // rather than by a signature. That is the right refusal: the name means
  // nothing here, and a type would have made it appear to mean something.
  expect(ok('let n: uint8 = escape("a");')).toBe(false);
  expect(ok('let n: string = escape("a");')).toBe(false);
});

test('Family B preserves the existing spellings and the run time', () => {
  // The compatibility guard, per compat/backwards-compatibility.test.mts: what a
  // wrong fixed type breaks is a program that ALREADY type-checked.
  expect(ok('let n: number = parseInt("1", 10);')).toBe(true);
  expect(ok('let n: string = encodeURIComponent("a b");')).toBe(true);
  expect(evaluated('String(parseInt("42") === 42);')).toBe('true');
  expect(evaluated('String(parseInt("42px") === 42);')).toBe('true');
  expect(evaluated('String(Number.isNaN(parseInt("x")));')).toBe('true');
  expect(evaluated('String(encodeURIComponent("a b") === "a%20b");')).toBe('true');
  // A program that shadows one gets its own, not the builtin's signature.
  expect(ok('if (false) { function parseInt(x) { return x; } let n: string = parseInt("1"); } 1;')).toBe(true);
});

// ---------------------------------------------------------------------------
// Family A - static DATA properties
// ---------------------------------------------------------------------------

test('a static data property states its type, at the EXISTING type', () => {
  // Not a call, so neither static table reaches it - a third dispatch site, and
  // the reason a census of calls could not see these.
  expectStaticTypeError('let n: string = Math.PI;');
  expect(ok('let n: number = Math.PI;')).toBe(true);
  expectStaticTypeError('let n: string = Number.MAX_SAFE_INTEGER;');
  expect(ok('let n: number = Number.MAX_SAFE_INTEGER;')).toBe(true);
  expect(ok('let n: number = Number.EPSILON;')).toBe(true);
  expect(ok('let n: number = Math.SQRT2;')).toBe(true);
});

test('a value type is REFUSED for a static data property', () => {
  // The compatibility bound, applied to a property.
  // #sec-overloading-of-the-standard-library: a value type "would change what
  // every existing call returns... since the values of distinct value types are
  // distinct". `float64` is not assignable to `number`, so `Math.PI: float64`
  // would refuse every existing `let n: number = Math.PI` - which is why the
  // table holds the type these already answer and not the one that looks more
  // precise.
  expectStaticTypeError('let n: float64 = Math.PI;');
  expectStaticTypeError('let n: uint64 = Number.MAX_SAFE_INTEGER;');
  // A program that wants one writes the conversion, as the clause says.
  expect(evaluated('const d: float64 = (Math.PI := float64); String(d > 3);')).toBe('true');
});

test('Family A leaves the arithmetic and the methods alone', () => {
  expect(evaluated('String(typeof Math.PI);')).toBe('number');
  expect(evaluated('String(Math.PI * 2 > 6);')).toBe('true');
  expect(evaluated('String(Number.MAX_SAFE_INTEGER + 1 > 0);')).toBe('true');
  // `Math.sqrt` is overloaded and unaffected by the property table beside it.
  expect(ok('const x: float32 = 4; let n: float32 = Math.sqrt(x);')).toBe(true);
  // An array's own members still resolve, which is what says the new branch
  // returns early only for the names it knows.
  expect(ok('const a: [].<uint8> = [1]; let n: uint64 = a.length;')).toBe(true);
  // A shadowed base gets nothing.
  expect(ok('if (false) { class M2 { } const Math = M2; let n: string = Math.PI; } 1;')).toBe(true);
});

// ---------------------------------------------------------------------------
// Group B - an element type in, an element type out
// ---------------------------------------------------------------------------

test('Array.from carries the element type through', () => {
  // `standardlibrary.md`, "Building From an Iterable". The first parameter is
  // the same `Iterable.<T>` the grouping functions take, so a typed array and a
  // COLLECTION both reach it by the interface they declare.
  expect(ok(`${A} let b: [].<uint32> = Array.from(a);`)).toBe(true);
  expectStaticTypeError(`${A} let b: [].<string> = Array.from(a);`);
  expect(ok('let s: Set.<uint8> = new Set(); let b: [].<uint8> = Array.from(s);')).toBe(true);
  expectStaticTypeError('let s: Set.<uint8> = new Set(); let b: [].<string> = Array.from(s);');
});

test('the mapped overload takes its result from the callback', () => {
  expect(ok(`${A} let b: [].<string> = Array.from(a, (x) => "k");`)).toBe(true);
  expectStaticTypeError(`${A} let b: [].<uint32> = Array.from(a, (x) => "k");`);
  // ...and the callback's parameter is typed from the source, as `groupBy`'s is.
  expect(ok(`${A} Array.from(a, (x) => { let s: uint32 = x; return "k"; });`)).toBe(true);
  expectStaticTypeError(`${A} Array.from(a, (x) => { let s: string = x; return "k"; });`);
});

test('Array.of gathers ONE element type from many arguments', () => {
  expect(ok('let b: [].<uint8> = Array.of((1 := uint8), (2 := uint8));')).toBe(true);
  expectStaticTypeError('let b: [].<string> = Array.of((1 := uint8), (2 := uint8));');
  // Where the arguments DISAGREE the call says nothing rather than picking the
  // first: a rest parameter binds one variable, and one variable cannot be two
  // types. Answering `[].<uint8>` for `Array.of(u8, "x")` would be a claim the
  // arguments contradict.
  expect(ok('if (false) { let b: uint8 = Array.of((1 := uint8), "x"); } 1;')).toBe(true);
  expect(ok('if (false) { let b: uint8 = Array.of(); } 1;')).toBe(true);
});

test('Iterator.from and Object.keys', () => {
  expectStaticTypeError(`${A} let n: string = Iterator.from(a).toArray()[0];`);
  expect(ok(`${A} let n: uint32 = Iterator.from(a).toArray()[0];`)).toBe(true);
  // `Object.keys` answers Strings whatever it is given, so it takes no type
  // parameter.
  expect(ok('let b: [].<string> = Object.keys({ a: 1 });')).toBe(true);
  expectStaticTypeError('let b: [].<uint8> = Object.keys({ a: 1 });');
});

test('Group B preserves participation and the run time', () => {
  // An UNTYPED source yields an untyped result: where T cannot be determined the
  // call has no static type, not one naming `any` in the element position -
  // `[].<any>` would claim a typed array where the program built an ordinary one.
  expect(ok('if (false) { const u = [1, 2]; let b: uint8 = Array.from(u); } 1;')).toBe(true);
  expect(evaluated('const u = [1, 2]; const b = Array.from(u); String(b.length);')).toBe('2');
  expect(evaluated(`${A} const b = Array.from(a); String(b.length) + String(Reflect.typeOf(b[0]) === (type uint32));`)).toBe('3true');
  expect(evaluated('String(Array.from(new Set([1, 2])).length) + String(Object.keys({ a: 1 })[0]);')).toBe('2a');
  expect(evaluated('String(Array.of(1, 2).length) + String(Iterator.from([1, 2]).toArray().length);')).toBe('22');
});
