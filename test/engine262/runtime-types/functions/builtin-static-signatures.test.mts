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

test.fails('D25: the result is not STAMPED, so its run-time count is a Number', () => {
  // `Map.groupBy` publishes `Map.<K, [].<T>>` statically while the value it
  // returns carries no type arguments. A program that ANNOTATES the result gets
  // it stamped by adoption at the boundary (#sec-collection-construction); one
  // that does not gets a static type its value does not match.
  //
  // Not unsound - a Number reaching a `uint64` position converts - but the two
  // halves disagree and the clause is the side that is right. Found by the
  // devtools example, which expected a typed count and measured a plain one.
  //
  // BROADER THAN FIRST FILED, and the cause is CHECK ELISION - the same shape
  // `sec-value-type-copying`'s note describes for a value-type copy.
  //
  // Measured: `let m: Map.<string, uint8> = new Map()` DOES adopt, and
  // `let g: Map.<…> = Map.groupBy(…)` does NOT - but laundering the same call
  // through `any` first does. So the boundary is being SKIPPED because the
  // checker can now prove the initializer already satisfies the annotation, and
  // adoption rides on that boundary.
  //
  // Phase 1 created this by giving `Map.groupBy` a Static Type: the elision is
  // correct for a CHECK, which cannot fail where the type is proven, and wrong
  // for ADOPTION, which is not a no-op. "A check that cannot fail does nothing.
  // A copy is never nothing" - and neither is a stamp.
  //
  // The inner array elements ARE typed, since they come from the typed source,
  // so only the Map's own stamp is missing.
  expect(evaluated(`${A} const g = Map.groupBy(a, (n) => "k"); String(Reflect.typeOf(g.size) === (type uint64));`)).toBe('true');
  expect(evaluated(`${A} const g = Map.groupBy(a, (n) => "k"); String(g is Map.<string, [].<uint32>>);`)).toBe('true');
  expect(evaluated(`${A} let g: Map.<string, [].<uint32>> = Map.groupBy(a, (n) => "k"); String(Reflect.typeOf(g.size) === (type uint64));`)).toBe('true');
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
  for (const p of ['isInteger', 'isFinite', 'isNaN', 'isSafeInteger']) {
    expectStaticTypeError(`let n: string = Number.${p}(1);`);
    expect(ok(`let n: boolean = Number.${p}(1);`), p).toBe(true);
  }
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
