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
