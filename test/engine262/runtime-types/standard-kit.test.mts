import { expect, test } from 'vitest';
import { STD_TYPES_SOURCE } from '../../../src/type-system/std-types.mts';
import {
  Agent, ManagedRealm, ModuleCache, setSurroundingAgent, Throw,
  composeModuleLoaders, createBuiltinModuleLoader,
} from '#self';

/**
 * proposal-runtime-types `annex-standard-kit`.
 *
 * The conformance suite for `std:types`. This file previously carried the kit
 * as a `const KIT` string of fifteen hand-written helpers prepended to each
 * program. That is gone: the kit is a real module now, and every assertion
 * below reaches it by `import`, which is the only way these tests can catch
 * what they exist to catch. A copy of the kit tested against itself proves
 * nothing about the kit anyone else loads.
 *
 * Its header also claimed that "type operators are not expression-position
 * forms in the current parser", and worked around it with type aliases. That
 * was stale: `type keyof T` parses in expression position, and the
 * agreement tests below use it directly.
 *
 * Four groups, and only the first is about individual helpers:
 *
 *   1. per-export, one test each, 71 of them
 *   2. the AGREEMENT obligations - "Where the kit and the core describe one
 *      operation, they must agree" - which is the annex's own requirement and
 *      the reason a kit written over the primitives is safe at all
 *   3. INTERNING across module boundaries, the annex's stated reason for
 *      shipping a module rather than a snippet
 *   4. the POLYFILL claim, which the annex states and nothing tested
 */

const NL = String.fromCharCode(10);

/**
 * The completion of a module evaluation, as `'ok'` or `'threw'`.
 *
 * `evaluateModule`'s callback does NOT receive a throw completion when the
 * module BODY throws: it receives a normal completion whose value is the
 * promise `module.Evaluate()` returned, and a body throw REJECTS that promise.
 * A harness that reads only the completion therefore reports `'ok'` for every
 * program, including `throw new Error('boom')` - which makes every assertion
 * written against it vacuous. Found by asserting a deliberate failure and
 * watching it pass.
 */
function settle(completion: unknown): string {
  const c = completion as { Type?: string, PromiseState?: string, Value?: { PromiseState?: string } };
  if (c?.Type === 'throw') {
    return 'threw';
  }
  // On the success path the callback is handed the PROMISE ITSELF, not a
  // completion wrapping it, so the state is on `c` rather than on `c.Value`.
  const state = c?.PromiseState ?? c?.Value?.PromiseState;
  if (state === 'rejected') {
    return 'threw';
  }
  if (state === 'fulfilled') {
    return 'ok';
  }
  return `unsettled (${String(state)})`;
}

/** Evaluate _body_ as a module with the kit in scope as `std`. */
function run(body: string): Promise<string> {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm({ resolverCache: new ModuleCache() });
  const parsed = realm.compileModule(`import * as std from "std:types";${NL}${body}`, { specifier: 'main' } as never);
  if ((parsed as { Type?: string }).Type === 'throw') {
    return Promise.resolve('compile threw');
  }
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 15_000);
    realm.evaluateModule((parsed as unknown as { Value: never }).Value, undefined, (completion) => {
      clearTimeout(timer);
      resolve(settle(completion));
    });
  });
}

/**
 * _expr_ must be true, evaluated with `std` in scope after _setup_.
 *
 * Setup is separate because it is STATEMENTS - a `type` alias, a class - and an
 * assertion is an EXPRESSION. Splicing the two together produces a compile
 * error rather than a failed assertion, which is a confusing way to learn that
 * a helper works fine.
 */
const holds = (expr: string, setup = '') => run(`${setup}${NL}if (!(${expr})) { throw new Error("assertion failed"); }`);

/** Evaluate a two-module program: the kit through the engine, _extra_ through a host loader. */
function runWith(extraSpecifier: string, extraSource: string, body: string): Promise<string> {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ resolverCache: new ModuleCache() });
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = composeModuleLoaders([
    createBuiltinModuleLoader({
      loadBuiltinModule: (request, _realm, callback) => {
        callback(request.Specifier === extraSpecifier
          ? extraSource
          : Throw.Error(`no module ${request.Specifier}`) as never);
      },
    }),
  ]) as never;
  const parsed = realm.compileModule(body, { specifier: 'main' } as never);
  if ((parsed as { Type?: string }).Type === 'throw') {
    return Promise.resolve('compile threw');
  }
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 15_000);
    realm.evaluateModule((parsed as unknown as { Value: never }).Value, undefined, (completion) => {
      clearTimeout(timer);
      resolve(settle(completion));
    });
  });
}

// ---------------------------------------------------------------------------
// 1. Per-export. One test each. The identity §4 claims for the helper, not a
//    shape check - `partial(User)` must BE `{ id?: uint8 }`, interned, and not
//    merely "an object type with an optional property".
// ---------------------------------------------------------------------------

const U = 'type U = { a: uint8, b: string };';
const TU = 'type TU = [uint8, string];';

const EXPORTS: ReadonlyArray<readonly [string, string, string]> = [
  // prelude / foundations (19)
  ['reflect', 'std.reflect(type { a: uint8 }).kind === "object"', ''],
  ['literal', 'std.literal("a") === type "a"', ''],
  ['union', 'std.union([type "a", type "b"]) === type "a" | "b"', ''],
  ['arms', 'std.arms(type "a" | "b").length === 2', ''],
  ['intersection', 'std.intersection([type { a: uint8 }, type { b: string }]) === type { a: uint8 } & { b: string }', ''],
  ['literalValues', 'std.literalValues(type "a" | "b").join(",") === "a,b"', ''],
  ['literalValue', 'std.literalValue(type "a") === "a"', ''],
  ['prop', 'std.prop("x", uint8).name === "x" && std.prop("x", uint8).type === uint8', ''],
  ['objectOf', 'std.objectOf([std.prop("a", uint8)]) === type { a: uint8 }', ''],
  ['tupleOf', 'std.tupleOf([uint8, string]) === type [uint8, string]', ''],
  ['arrayOf', 'std.arrayOf(uint8) === type [].<uint8>', ''],
  ['tupleElements', 'std.tupleElements(TU).length === 2', TU],
  ['elementTypes', 'std.elementTypes(TU)[1] === string', TU],
  ['mapProperties', 'std.mapProperties(U, p => p) === U', U],
  ['mapPropertyTypes', 'std.mapPropertyTypes(type { a: uint8 }, () => string) === type { a: string }', ''],
  ['mapElements', 'std.mapElements(type [uint8, uint8], () => string) === type [string, string]', ''],
  ['propertyType', 'std.propertyType(U, "b") === string', U],
  ['genericApplication', 'std.genericApplication(type Promise, [string]) === type Promise.<string>', ''],
  ['fn', 'std.fn([uint8], string) === type (uint8) => string', ''],

  // keys and indexing (3)
  ['keys', 'std.keys(U) === type keyof U', U],
  ['indexed', 'std.indexed(U, type "a") === uint8', U],
  ['paths', 'std.paths(type { a: { b: uint8 } }) === type "a" | "a.b"', ''],

  // object utilities (12)
  ['partial', 'std.partial(type { a: uint8 }) === type { a?: uint8 }', ''],
  ['required', 'std.required(type { a?: uint8 }) === type { a: uint8 }', ''],
  ['readonly', 'std.readonly(type { a: uint8 }) === type { readonly a: uint8 }', ''],
  ['mutable', 'std.mutable(type { readonly a: uint8 }) === type { a: uint8 }', ''],
  ['pick', 'std.pick(U, type "a") === type { a: uint8 }', U],
  ['omit', 'std.omit(U, ["b"]) === type { a: uint8 }', U],
  ['record', 'std.record(type "r" | "w", boolean) === type { r: boolean, w: boolean }', ''],
  ['pickByValue', 'std.pickByValue(U, string) === type { b: string }', U],
  ['removeKind', 'std.removeKind(type { kind: "k", a: uint8 }) === type { a: uint8 }', ''],
  ['merge', 'std.merge(type { a: uint8, b: string }, type { b: boolean }) === type { a: uint8, b: boolean }', ''],
  ['renameProperties', 'std.renameProperties(type { a: uint8 }, n => n.toUpperCase()) === type { A: uint8 }', ''],
  ['getters', 'std.getters(type { x: uint8 }) === type { readonly getX: () => uint8 }', ''],

  // unions (7)
  ['exclude', 'std.exclude(type "a" | "b" | "c", type "b") === type "a" | "c"', ''],
  ['extract', 'std.extract(type "a" | 42, string) === type "a"', ''],
  ['nonNullable', 'std.nonNullable(type string | null | undefined) === string', ''],
  ['mapUnion', 'std.mapUnion(type "a" | "b", a => std.arrayOf(a)) === type [].<"a"> | [].<"b">', ''],
  ['discriminants', 'std.discriminants(type { kind: "a" } | { kind: "b" }).join(",") === "a,b"', ''],
  ['byKind', 'std.byKind(type { kind: "a", v: uint8 } | { kind: "b" }, "a") === type { kind: "a", v: uint8 }', ''],
  ['handlers', 'std.reflect(std.handlers(type { kind: "a" } | { kind: "b" }, string)).properties.length === 2', ''],

  // functions (7)
  ['parameters', 'std.parameters(type (uint8, string) => void) === type [uint8, string]', ''],
  ['firstParameter', 'std.firstParameter(type (uint8, string) => void) === uint8', ''],
  ['returnType', 'std.returnType(type (uint8) => string) === string', ''],
  ['constructorParameters', 'std.constructorParameters(type K) === type [uint8, string]', 'class K { x: uint8 = 1; constructor(a: uint8, b: string) {} }'],
  // The absent case is `never`, not `any`: #sec-this-adoption says a signature
  // with none "supplies no `this` rather than accepting any", so the set of
  // receivers it admits is empty.
  ['thisParameterType', 'std.thisParameterType(std.withThisType(type () => string, type { a: uint8 })) === type { a: uint8 }'
    + ' && std.thisParameterType(type () => string) === (type never)', ''],
  ['omitThisParameter', 'std.omitThisParameter(std.withThisType(type () => string, type { a: uint8 })) === type () => string', ''],
  ['withThisType', 'std.reflect(std.withThisType(type () => string, type { a: uint8 })).signatures[0].thisType === (type { a: uint8 })', ''],

  // tuples and arrays (8)
  ['head', 'std.head(TU) === uint8', TU],
  ['tail', 'std.tail(TU) === type [string]', TU],
  ['concat', 'std.concat(type [uint8], type [string]) === type [uint8, string]', ''],
  ['reverse', 'std.reverse(TU) === type [string, uint8]', TU],
  ['zip', 'std.zip(type [uint8], type [string]) === type [[uint8, string]]', ''],
  ['flatten', 'std.flatten(type [].<uint8>) === uint8', ''],
  ['toArrayAll', 'std.toArrayAll(type string | uint8) === type [].<string | uint8>', ''],
  ['toArrayEach', 'std.toArrayEach(type string | uint8) === type [].<string> | [].<uint8>', ''],

  // literals and strings (6)
  ['mapLiterals', 'std.mapLiterals(type "a" | "b", s => s + "!") === type "a!" | "b!"', ''],
  ['uppercase', 'std.uppercase(type "ab") === type "AB"', ''],
  ['lowercase', 'std.lowercase(type "AB") === type "ab"', ''],
  ['capitalized', 'std.capitalized(type "ab") === type "Ab"', ''],
  ['uncapitalized', 'std.uncapitalized(type "AB") === type "aB"', ''],
  ['routeParams', 'std.routeParams("/u/:id/p/:pid") === type { id: string, pid: string }', ''],

  // recursion and composition (5)
  ['deepPartial', 'std.deepPartial(type { a: { b: uint8 } }) === type { a?: { b?: uint8 } }', ''],
  ['deepMap', 'std.deepMap(type { a: uint8 }, () => string) === type { a: string }', ''],
  ['traverse', 'std.traverse(type { a: { b: uint8 } }, { property: p => ({ ...p, readonly: true }) }) === type { readonly a: { readonly b: uint8 } }', ''],
  ['compose', 'std.compose(std.partial, std.mutable)(type { readonly a: uint8 }) === type { a?: uint8 }', ''],
  ['awaited', 'std.awaited(type Promise.<uint8>) === uint8', ''],

  // maximal set (4)
  ['noInfer', 'std.noInfer(uint8) === uint8', ''],
  // Unblocked once `makeType` gained a `parameterized` case and
  // `src/intrinsics/Brand.mts` claimed the `brand` key. It was the ONE blocked
  // export of the 71 and carried this file's only `test.todo`.
  ['brand', "std.brand(uint32, 'UserId') === type uint32.<{ brand: 'UserId' }>", ''],
  ['options', 'std.reflect(std.options(type { n: uint8 }, type { inc: () => void })).properties.length === 2', ''],
  ['listeners', 'std.listeners(type { x: uint8 }) === type { onXChanged: (uint8) => void }', ''],
  // typeprogramming.md R15 / #sec-declared-inverses: `@inverse(fn)` on a
  // BUILDER declares the function that proposes its argument, so a pack
  // reached only through the builder can be inferred. The decorator is
  // `Reflect.declareInverse` applied at the declaration; the row checks that
  // the export IS that decorator and that applying it registers the inverse.
  // #sec-primitive-metadata's StringPattern builders. Withheld while the `pattern` claim
  // looked provisional; the key is claimed by a shipped intrinsic either way, so
  // withholding preserved nothing. Validation is live, which is what they use.
  ['suffixed', 'typeof std.suffixed === "function" && std.suffixed.length === 1', ''],
  ['prefixed', 'typeof std.prefixed === "function" && std.prefixed.length === 1', ''],
  ['stringPattern', 'typeof std.stringPattern === "function"', ''],
  ['inverse', 'typeof std.inverse === "function" && std.inverse.length === 2 && unpack(new Box.<uint8>(1)) === "uint.<8>"',
    'class Box<T> { v: T; constructor(v: T) { this.v = v; } }' + NL
    + 'function unboxed(Bs) { return Reflect.makeType({ kind: "tuple", elements: Reflect.getReflection(Bs).elements.map((e) => ({ type: Reflect.getReflection(e.type).generic.arguments[0] })) }); }' + NL
    + '@std.inverse(unboxed)' + NL
    + 'function boxesOf(Ts) { return Reflect.makeType({ kind: "tuple", elements: Reflect.getReflection(Ts).elements.map((e) => { const t = e.type; return { type: type Box.<t> }; }) }); }' + NL
    + 'function unpack<...Ts>(...bs: boxesOf(Ts)): string { return Reflect.getReflection(Ts).elements.map((e) => String(e.type)).join(","); }'],
];

test('the table covers every export, and only exports', async () => {
  // Guards the suite against the kit growing past it. A helper added without a
  // test fails on the count here rather than passing unnoticed.
  const named = EXPORTS.map(([name]) => name);
  // 75: the 71 of `typeprogramming.md`'s table, plus `inverse` from
  // #sec-declared-inverses and the three StringPattern builders. The guard below fired on it, as it should - an
  // export with no row here is an export with no test.
  expect(new Set(named).size).toBe(75);
  expect(await run(`const extra = Object.keys(std).filter(k => !${JSON.stringify(named)}.includes(k));`
    + ' if (extra.length) { throw new Error("untested exports: " + extra.join(",")); }'
    + ` if (Object.keys(std).length !== ${named.length}) { throw new Error("count " + Object.keys(std).length); }`)).toBe('ok');
});

test.each(EXPORTS)('%s', async (_name, expr, setup) => {
  expect(await holds(expr, setup ?? '')).toBe('ok');
});


// ---------------------------------------------------------------------------
// 2. The agreement obligations. `annex-standard-kit`: "Where the kit and the
//    core describe one operation, they must agree."
// ---------------------------------------------------------------------------

test('agreement: `keys` IS `keyof`, including where reflection cannot see', async () => {
  // Satisfied by construction - `keys` forwards to the operator - and the test
  // says so rather than proving it. The cases that matter are the ones a
  // reimplementation over `reflect()` would have got WRONG, which is why that
  // direction was ruled out: reflection collapses a nominal to an opaque
  // `primitive` leaf, so a hand-written version could not have answered for a
  // class or an interface at all.
  expect(await holds('std.keys(type { a: uint8, b: string }) === type keyof { a: uint8, b: string }')).toBe('ok');
  expect(await holds('std.keys(type { a: uint8 } | { a: string }) === type keyof ({ a: uint8 } | { a: string })')).toBe('ok');
  expect(await holds('std.keys(type { a: uint8 } & { b: string }) === type keyof ({ a: uint8 } & { b: string })')).toBe('ok');
  expect(await holds('std.keys(type K) === type keyof K', 'class K { x: uint8 = 1; y: string = ""; }')).toBe('ok');
});

test('agreement: keyless is `never`, and the refusal lives at the USE', async () => {
  // Asserted as a pair, because either half alone reads as a bug. `keys` of a
  // keyless type is not an error - the fold is total - and the diagnostic
  // arrives where the keys are consumed, which is what indexed access already
  // does and does better: `keyof` cannot say what the keys were wanted for.
  expect(await holds('std.keys(uint8) === never')).toBe('ok');
  expect(await holds('std.keys(type {}) === never')).toBe('ok');
  expect(await holds('std.keys(never) === never')).toBe('ok');
  // one keyless arm empties the union, matching the operator
  expect(await holds('std.keys(type { a: uint8 } | uint8) === type keyof ({ a: uint8 } | uint8)')).toBe('ok');
  // and the use refuses, in both spellings
  expect(await run('const x = type uint8["a"]; x;')).toBe('threw');
  expect(await run('std.indexed(uint8, type "a");')).toBe('threw');
});

test('agreement: `indexed` IS `T[K]`', async () => {
  // §4.1's `js` block is missing from typeprogramming.md, so `indexed`
  // had no definition anywhere and this reconstruction is the only statement of
  // it. Pinned against the operator across the cases
  // #sec-indexed-access-types names.
  expect(await holds('std.indexed(type { a: uint8 }, type "a") === type { a: uint8 }["a"]')).toBe('ok');
  // distributes over K's arms
  expect(await holds('std.indexed(U, type "a" | "b") === type U["a" | "b"]', U)).toBe('ok');
  // distributes over T's arms. Written through an ALIAS, not as
  // `type ({ a: uint8 } | { a: string })["a"]`, because the parenthesised
  // spelling does not parse - see the anchor below.
  expect(await holds('std.indexed(AB, type "a") === type AB["a"]',
    'type AB = { a: uint8 } | { a: string };')).toBe('ok');
  // an optional property's read admits `undefined`
  expect(await holds('std.indexed(type { a?: uint8 }, type "a") === type { a?: uint8 }["a"]')).toBe('ok');
  // and a missing property refuses, as the operator does
  expect(await run('std.indexed(type { a: uint8 }, type "zz");')).toBe('threw');
});

test('anchor: `type (A | B)["k"]` does not parse', async () => {
  // RECORDED, NOT FIXED, and found by writing the agreement test above.
  //
  // Indexed access over a union operand works - `type AB["a"]` where
  // `AB = { a: uint8 } | { a: string }` answers `uint8 | string`, agreeing with
  // `std.indexed`. But the PARENTHESISED spelling of the same type fails with
  // "0 is not assignable to \"type\"", which is a parse failure rather than a
  // semantic one: the operand is being read as something other than a
  // parenthesised type, and the diagnostic mentions a `0` the program never
  // wrote.
  //
  // So this is not a kit/core disagreement - the kit is right and the operator
  // is right, and one spelling of the operator is broken. Failing-by-design:
  // when it parses, this assertion breaks and whoever fixes it should switch
  // the agreement test above back to the direct spelling.
  expect(await run('const x = type ({ a: uint8 } | { a: string })["a"]; x;')).toBe('threw');
  // the alias spelling, which is the same type, is fine
  expect(await holds('type AB["a"] === type uint8 | string',
    'type AB = { a: uint8 } | { a: string };')).toBe('ok');
});

test('agreement: the round trip, over every kind the READ side emits', async () => {
  // `makeType(getReflection(T)) === T`. The failure this guards is a kind added
  // to one side only, which is how `enum` and `parameterized` came to be
  // emitted and rejected.
  const kinds: ReadonlyArray<readonly [string, string]> = [
    ['primitive', 'uint8'],
    ['literal', 'type "a"'],
    ['union', 'type "a" | "b"'],
    ['intersection', 'type { a: uint8 } & { b: string }'],
    ['tuple', 'type [uint8, string]'],
    ['array', 'type [].<uint8>'],
    ['object', 'type { a: uint8, b?: string }'],
    ['object with an index signature', 'type { [key: string]: uint8 }'],
    ['function', 'type (uint8) => string'],
  ];
  for (const [kind, spelling] of kinds) {
    expect(await holds(`Reflect.makeType(Reflect.getReflection(${spelling})) === ${spelling}`), kind).toBe('ok');
  }
  // `parameterized` round-trips, brand and pattern alike. It was asserted here
  // as an EXCEPTION so that closing it would break this test; it was closed,
  // and then the rewrite recorded that a pattern was still only
  // stable-but-unequal. That closed too: the metadata is now read back
  // structurally to the depth of the record, and the marker's own discriminant
  // is compared across both representations.
  //
  // `sec-reflect-maketype` states this as an IDENTITY - "which is what makes
  // the round trip the identity function rather than an equivalence" - so `===`
  // is the assertion, not a shape check. Every weaker check passed while this
  // was broken.
  expect(await holds('Reflect.makeType(Reflect.getReflection(Px)) === Px',
    'type Px = string.<{ pattern: /^a$/ }>;')).toBe('ok');
  expect(await holds('Reflect.makeType(Reflect.getReflection(B)) === B',
    "type B = uint32.<{ brand: 'UserId' }>;")).toBe('ok');
  // A Value leaf and a marker leaf in ONE record - the case that would catch a
  // fix handling one leaf kind and not the mix.
  expect(await holds('Reflect.makeType(Reflect.getReflection(M)) === M',
    "type M = string.<{ brand: 'Name', pattern: /^a$/ }>;")).toBe('ok');
  // `enum` was the last exception, and it closed by removing the kind rather
  // than by adding a write-side case. An enum reflects as the `primitive` leaf
  // #table-reflection-nodes assigns it, so it round-trips by the first row of
  // the list above and needs no case of its own; `family` carries the enum-ness
  // a walker would otherwise have needed a kind for.
  expect(await holds('Reflect.makeType(Reflect.getReflection(type E)) === (type E)',
    'enum E { a, b }')).toBe('ok');
  expect(await holds("Reflect.getReflection(type E).family === 'enum'", 'enum E { a, b }')).toBe('ok');
});

test('a struct CONTAINING a parameterized field round-trips, and walks preserve it', async () => {
  // The correction to an earlier claim that every deep walk was broken.
  // A field's type rides as a Type Object rather than a nested node, so a walk
  // reaches `kind: 'parameterized'`, falls to its default arm, and passes the
  // type through untouched. Which means §8's "metadata inside walks" already
  // has its answer in practice: preserved.
  const PX = 'type Px = string.<{ pattern: /^a$/ }>; type S = { w: Px };';
  expect(await holds('Reflect.makeType(Reflect.getReflection(S)) === S', PX)).toBe('ok');
  expect(await holds('Reflect.getReflection(std.deepPartial(S)).properties[0].type === Px', PX)).toBe('ok');
  expect(await holds('std.traverse(S) === S', PX)).toBe('ok');
});

// ---------------------------------------------------------------------------
// 3. Interning across module boundaries.
// ---------------------------------------------------------------------------

test('interning: `partial(User)` in two packages is one type', async () => {
  // `annex-standard-kit`'s stated reason for shipping a module rather than a
  // snippet, and nothing tested it. The helper module resolves through a HOST
  // loader while the kit resolves through the engine, so this is the
  // coexistence test as well.
  const helper = 'import { partial } from "std:types";' + NL
    + 'export const make = (T) => partial(T);';
  const main = 'import { partial } from "std:types";' + NL
    + 'import { make } from "helper";' + NL
    + 'type User = { id: uint8 };' + NL
    + 'if (make(User) !== partial(User)) { throw new Error("two modules, two types"); }';
  expect(await runWith('helper', helper, main)).toBe('ok');
});

// ---------------------------------------------------------------------------
// 4. The polyfill claim.
// ---------------------------------------------------------------------------

test('the polyfill claim: the same source loads as an ordinary user module', async () => {
  // `annex-standard-kit`: the kit "ships as source" and "a codebase that cannot
  // assume the module can polyfill it verbatim." That is a testable sentence,
  // and this is the test. The SAME text - `STD_TYPES_SOURCE`, imported from the
  // engine rather than copied - is loaded under an ordinary specifier through
  // an ordinary host loader and must behave identically.
  //
  // If this fails, the kit has acquired a dependency on being resolved as
  // `std:types` and the annex's claim is false.
  const main = 'import * as builtin from "std:types";' + NL
    + 'import * as poly from "polyfill";' + NL
    + 'type User = { id: uint8, name: string };' + NL
    + 'if (Object.keys(poly).length !== Object.keys(builtin).length) { throw new Error("different surface"); }' + NL
    + 'if (poly.partial(User) !== builtin.partial(User)) { throw new Error("partial disagrees"); }' + NL
    + 'if (poly.keys(User) !== builtin.keys(User)) { throw new Error("keys disagrees"); }' + NL
    + 'if (poly.deepPartial(type { a: { b: uint8 } }) !== builtin.deepPartial(type { a: { b: uint8 } })) { throw new Error("deepPartial disagrees"); }';
  expect(await runWith('polyfill', STD_TYPES_SOURCE, main)).toBe('ok');
});

// typeprogramming.md 6.2: the kit carries its own contracts, so the mechanism
// has a user and downstream generic code has a reasoned surface. The bounds are
// the variance each builder actually has - a widening makes the argument
// assignable to the result, a narrowing the reverse - and #sec-checked-contracts
// verifies them at every concrete evaluation, which is the half that crosses a
// module boundary.
test('the kit states its own bounds, and they hold', async () => {
  const T = 'type T = { a: uint8, b: string }; ';
  // Widenings: the argument is assignable to the result.
  expect(await holds('Reflect.isAssignable(T, std.partial(T))', T)).toBe('ok');
  expect(await holds('Reflect.isAssignable(T, std.readonly(T))', T)).toBe('ok');
  expect(await holds('Reflect.isAssignable(T, std.pick(T, type "a"))', T)).toBe('ok');
  expect(await holds('Reflect.isAssignable(T, std.omit(T, type "b"))', T)).toBe('ok');
  // Narrowings: the result is assignable to the argument.
  expect(await holds('Reflect.isAssignable(std.required(std.partial(T)), std.partial(T))', T)).toBe('ok');
  expect(await holds('Reflect.isAssignable(std.mutable(std.readonly(T)), std.readonly(T))', T)).toBe('ok');
  // Filtering arms leaves a subtype of the union filtered.
  const U = 'type U = uint8 | string | void; ';
  expect(await holds('Reflect.isAssignable(std.exclude(U, type void), U)', U)).toBe('ok');
  expect(await holds('Reflect.isAssignable(std.extract(U, type uint8 | string), U)', U)).toBe('ok');
  expect(await holds('Reflect.isAssignable(std.nonNullable(U), U)', U)).toBe('ok');
  // Dropping members leaves a supertype.
  expect(await holds('Reflect.isAssignable(T, std.pickByValue(T, uint8))', T)).toBe('ok');
  expect(await holds("Reflect.isAssignable(K, std.removeKind(K))", 'type K = { kind: "x", a: uint8 }; ')).toBe('ok');
  // merge states its bound on B ALONE. With overlapping keys B wins the shared
  // member, so the result carries B's type and a writable member is invariant -
  // the result is not assignable to A. Measured on a favourable example the
  // stronger bound looked true; the corpus found the overlap.
  expect(await holds('Reflect.isAssignable(std.merge(A, B), B)',
    'type A = { a: uint8 }; type B = { a: string, b: string }; ')).toBe('ok');
});

// A KIND FACT is what a builder states when no subtyping bound exists: the
// result of `parameters(F)` is not related to `F` by assignability, but a
// downstream builder that walks it needs to know it walks a tuple. Measured
// stable at the edges - an empty tuple still reflects as `tuple`, an object with
// only an index signature still as `object`.
test('the kit states the kind it produces where it can', async () => {
  const kind = (expr: string, want: string, decl = '') =>
    holds(`Reflect.getReflection(${expr}).kind === "${want}"`, decl);
  const T = 'type T = { a: uint8, b: string }; ';
  const F = 'type F = (uint8, string) => void; ';
  expect(await kind('std.parameters(F)', 'tuple', F)).toBe('ok');
  expect(await kind('std.concat(type [uint8], type [string])', 'tuple')).toBe('ok');
  expect(await kind('std.reverse(type [uint8, string])', 'tuple')).toBe('ok');
  expect(await kind('std.zip(type [uint8], type [string])', 'tuple')).toBe('ok');
  expect(await kind('std.getters(T)', 'object', T)).toBe('ok');
  expect(await kind('std.record(type string, uint8)', 'object')).toBe('ok');
  // And where none is true it states none: `flatten` unwraps an array to its
  // element, so its result is whatever the element was.
  expect(await kind('std.flatten(type [].<uint8>)', 'primitive')).toBe('ok');
  // The facts are stated as a disjunction with `never` because canonicalization
  // collapses a composite whose required component is uninhabited. Both of these
  // reach the builder and come back `never`, and the contract holds.
  expect(await holds('std.tupleOf([uint8, never]) === never')).toBe('ok');
  expect(await holds('std.objectOf([std.prop("a", never)]) === never')).toBe('ok');
  // An OPTIONAL never member does not collapse it, nor does an array of never.
  expect(await kind('std.objectOf([std.prop("a", never, { optional: true })])', 'object')).toBe('ok');
  expect(await kind('std.arrayOf(never)', 'array')).toBe('ok');
});
