// PLAN-variadic-and-named-generic-arguments.md Appendix B (Phase 8): the
// integrated stress programs, each combining features the A-files isolate.
// A failure here with green A-files is a COMPOSITION bug - the likeliest kind
// after two resolvers. What a remainder still owes is pinned as `test.fails`
// with its finding, so a silent fix or a regression is equally loud.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// ---- B.1 SIMD slice: value packs, where over class parameters, value view, specialized values, identity ----
const VEC = `
class vec<T, N: uint32> {
  #lanes: [].<T>;
  constructor(xs: [].<T>) { this.#lanes = xs; }
  swizzle<...I: [].<uint32>>(): [].<T> where I.every((i) => i < N) && I.length > 0 {
    const out: [].<T> = [];
    for (let j = 0; j < I.length; j++) { out.push(this.#lanes[I[j]]); }
    return out;
  }
}
const V4 = vec.<float32, 4>;
const v = new V4([1, 2, 3, 4]);`;

test('B.1: a value pack drives a method, checked by a where over the CLASS parameter', () => {
  expect(evaluated(`${VEC} v.swizzle.<0, 0, 0, 0>().join(",");`)).toBe('1,1,1,1');
  expect(evaluated(`${VEC} v.swizzle.<3, 2, 1, 0>().join(",");`)).toBe('4,3,2,1');
  expect(evaluated(`${VEC} v.swizzle.<I: 3, 2>().join(",");`)).toBe('4,3');
  expectThrown(`${VEC} v.swizzle.<0, 4>();`, 'where');
  expectThrown(`${VEC} v.swizzle.<>();`, 'where');
  expectThrown(`${VEC} v.swizzle.<0, -1>();`);
});

test('B.1: spread and specialization-as-value compose - one specialization, receiver-independent', () => {
  expect(evaluated(`${VEC} type Pair = [1, 0]; v.swizzle.<...Pair>().join(",");`)).toBe('2,1');
  expect(evaluated(`${VEC} String(V4.prototype.swizzle.<0, 1> === v.swizzle.<0, 1>);`)).toBe('true');
  expect(evaluated(`${VEC} String(v.swizzle.<0, 1> === v.swizzle.<...[0, 1]>);`)).toBe('true');
  expect(evaluated(`${VEC} const s = v.swizzle.<0, 1>; s.call(v).join(",");`)).toBe('1,2');
  expect(evaluated(`${VEC} String([v].map((x) => x.swizzle.<0, 1>()).length);`)).toBe('1');
});

test('B.1: the pack reflects with its variadic flag', () => {
  expect(evaluated(`${VEC} const r = Reflect.getReflection(Reflect.typeOf(V4.prototype.swizzle)); String(r.signatures[0].typeParameters[0].name + ":" + r.signatures[0].typeParameters[0].variadic);`)).toBe('I:true');
});

// ---- B.2 ECS: ref-distribution, two same-bound packs, named runs, forwarding ----
test('B.2: two same-bound adjacent type packs bind by names and positionally', () => {
  const W = 'class Transform {} class Velocity {} class Frozen {} class World { each<...Cs extends [].<any>, ...Not extends [].<any>>(): string { return String(Reflect.getReflection(Cs).elements.length) + "/" + String(Reflect.getReflection(Not).elements.length); } }';
  expect(evaluated(`${W} new World().each.<Cs: Transform, Not: Frozen>();`)).toBe('1/1');
  expect(evaluated(`${W} new World().each.<Transform, Velocity>();`)).toBe('2/0');
});

test('B.2: a pack infers from ref-rest arguments, and a ref run forwards (F-T closed)', () => {
  // `ref ...xs: Cs` binds NO array - the run of the callers' locations - and
  // Cs binds from the referents' types; `cb(...xs)` forwards the run into the
  // callback's ref-rest position; each `ref x` in the callback writes through.
  expect(evaluated('function apply2<...Cs>(cb: (ref ...xs: Cs) => void, ref ...xs: Cs): void { cb(...xs); } let a: uint32 = 1; let f: float32 = 2; apply2((ref x: uint32, ref y: float32) => { x = 2; y = 3; }, ref a, ref f); String(a === 2 && f === 3);')).toBe('true');
});

// ---- B.3 Typed event bus: generic signature records end to end ----
const BUS = 'class Click { x: uint8 = 1; } class KeyDown {} function logAny<T>(e: T): void {} function route(e: Click): string { return "click"; } function route<T>(e: T): string { return "one"; } function route<...Es>(...es: Es): string { return "many"; }';

test('B.3: identity, the assignability directions, and the overload ladder compose', () => {
  expect(evaluated(`${BUS} type Handler = <T>(e: T) => void; String(Reflect.typeOf(logAny) === Handler);`)).toBe('true');
  expect(evaluated(`${BUS} let h: <U>(e: U) => void = logAny; "ok";`)).toBe('ok');
  expectThrown(`${BUS} let h2: <T>(e: T) => void = (e: Click): void => {};`, 'not assignable');
  expect(evaluated(`${BUS} let g: (e: Click) => void = logAny; g(new Click()); "ok";`)).toBe('ok');
  expect(evaluated(`${BUS} route(new Click());`)).toBe('click');
  expect(evaluated(`${BUS} route(new KeyDown());`)).toBe('one');
});

test('B.3: specializations as values are interned, keyed, and typed', () => {
  expect(evaluated(`${BUS} const lc = logAny.<Click>; const m = new Map(); m.set(lc, 1); String(m.get(logAny.<Click>));`)).toBe('1');
  expect(evaluated(`${BUS} String(Reflect.typeOf(logAny.<Click>));`)).toBe('(e: Click) => void');
});

test('B.3: a class satisfies a generic interface by shape under its own parameter names, via implements (F-Q dissolved)', () => {
  // F-Q was not a gap: classes are NOMINAL here, so an instance satisfies an
  // interface by declaring `implements` (an object literal satisfies by shape).
  // Under `implements`, the generic method compares up to renaming.
  expect(evaluated('interface Bus { on<T>(name: string, h: (e: T) => void): void; } class SimpleBus implements Bus { on<U>(name: string, h: (e: U) => void): void {} } let b: Bus = new SimpleBus(); "ok";')).toBe('ok');
  expect(evaluated('interface Bus { on(name: string): void; } let b: Bus = { on(name: string): void {} }; "ok";')).toBe('ok');
});

// F-AB, pinned as a PRE-EXISTING general gap: `implements` verifies nothing at
// declaration - a missing method, a wrong concrete parameter type, and a
// generic method of the wrong shape (`on<T, U>` for `on<T>`) are all accepted.
// `ClassImplements` is name-based. The generic case will follow whatever
// member verification the design adopts for `implements`; the identity-up-to-
// renaming relation it needs is in place.
test.fails('B.3: implements refuses a generic method of a different shape (F-AB, pre-existing)', () => {
  expectThrown('interface Bus { on<T>(name: string, h: (e: T) => void): void; } class Bad implements Bus { on<T, U>(name: string, h: (e: T) => void): void {} }');
});

test('B.3: the pack member of an overload set takes what the others cannot', () => {
  expect(evaluated(`${BUS} route(new Click(), new KeyDown());`)).toBe('many');
});

// ---- B.4 Packet reader: tuple growth, the budget ----
test('B.4: a specialization chain grows a tuple by splicing (F-S closed)', () => {
  // `[...Ts, T]` under Ts = [uint8] interns as `[uint8, string]`: CanonicalizeType
  // splices a rest element whose type is a tuple, and the class specialization
  // keys on the canonical record. (`Reader.<…>` in expression position is the
  // specialized CONSTRUCTOR; the type is `type Reader.<…>`.)
  expect(evaluated('class Reader<Ts extends [].<any> = []> { read<T>(): Reader.<[...Ts, T]> { return new Reader.<[...Ts, T]>(); } } const r = new Reader().read.<uint8>().read.<string>(); String(r instanceof Reader.<[uint8, string]> && Reflect.typeOf(r) === type Reader.<[uint8, string]>);')).toBe('true');
  expect(evaluated('type A = [...[uint8, string], boolean]; String(A === type [uint8, string, boolean]);')).toBe('true');
});

test('B.4: polymorphic recursion is stopped by the budget, not the stack (F-V closed)', () => {
  // Nested specialized calls each push a frame; past the depth limit the
  // application is refused with a diagnostic naming the budget - before this
  // the host's stack died and took the test worker with it.
  expectThrown('function grow<...Ts>(...xs: Ts): uint32 { return grow.<...Ts, uint8>(...xs, 0); } grow();', 'budget');
});

// ---- B.5 The binder kitchen sink: every argument form against one declaration ----
const STRESS = 'function stress<T = float64, ...I: [].<uint32>, N: uint32, ...S: [].<string>, M: uint32 = 3>(): string where I.every((i) => i < N) { return String(I.length) + "/" + String(N) + "/" + String(S.length) + "/" + String(M); }';

test('B.5: positional, named, named-run, spread, and default forms bind one declaration', () => {
  expect(evaluated(`${STRESS} stress.<uint8, 0, 1, 2, N: 4, S: "a", "b">();`)).toBe('3/4/2/3');
  expect(evaluated(`${STRESS} stress.<0, 1, 2>();`)).toBe('1/2/0/3');           // T takes the literal type 0; I=[1]; N=2
  expect(evaluated(`${STRESS} stress.<T: uint8, N: 2, I: 0, 1, M: 5>();`)).toBe('2/2/0/5');
  expect(evaluated(`${STRESS} stress.<...[uint8, 0, 1], N: 4>();`)).toBe('2/4/0/3');
  expect(evaluated(`${STRESS} stress.<N: 4>();`)).toBe('0/4/0/3');
  expect(evaluated(`${STRESS} stress.<uint8, 0, 1, N: 2, S: "x">();`)).toBe('2/2/1/3');
});

test('B.5: the refusals, each by its own rule', () => {
  expectThrown(`${STRESS} stress.<uint8, 0, 1, "x", 3>();`);                        // the type-blind split hands 'x' to N; step 8 refuses
  expectThrown(`${STRESS} stress.<T: uint8, N: 1, I: 0, 1>();`, 'where');
  expectThrown(`${STRESS} stress.<>();`, 'has no argument and no default');
  expectThrown(`${STRESS} stress.<uint8, I: 0, N: 4, 1>();`, 'positional');
  expectThrown(`${STRESS} stress.<uint8, N: 4, N: 5>();`, 'supplied twice');
  expectThrown(`${STRESS} function u(xs: [].<uint32>) { return stress.<uint8, ...xs, N: 4>(); } u([1]);`);   // a spread operand that is no type; the checker's static E6 is F-AA below
});

test('B.5: identity is the ordered bindings, never the spelling', () => {
  expect(evaluated(`${STRESS} String(stress.<uint8, N: 4> === stress.<T: uint8, N: 4, M: 3>);`)).toBe('true');
  expect(evaluated(`${STRESS} String(stress.<uint8, N: 4> !== stress.<uint8, N: 5>);`)).toBe('true');
});

test('B.5: a spread of a dynamic array TYPE is refused statically (F-AA closed for types)', () => {
  // E6 without running the program: the body of `u` is never evaluated.
  expectThrown(`${STRESS} function u() { return stress.<uint8, ...[].<uint32>, N: 4>(); }`, 'stated extent');
});

test('B.5: a spread naming a value is refused statically (F-AA closed)', () => {
  expectThrown(`${STRESS} function u(xs: [].<uint32>) { return stress.<uint8, ...xs, N: 4>(); }`, 'the value xs');
});

test('B.5: a default reads an earlier pack - class form (F-W, runtime half closed)', () => {
  // `M: uint32 = I.length`: the qualified name's head is a VALUE parameter and
  // reads as its value - the pack's frozen array - under the binder's frame.
  expect(evaluated('class C<...I: [].<uint32>, M: uint32 = I.length> { m(): uint32 { return M; } } String(new C.<0, 1, 2>().m());')).toBe('3');
  expect(evaluated('function d<...I: [].<uint32>, N: uint32>(): uint32 where I.length < 5 { return N; } String(d.<0, 1, N: 5>());')).toBe('5');
});

test('B.5: a default reads an earlier pack - function form (F-W closed)', () => {
  // The root cause was in inference, not the checker: at every generic call
  // InferGenericBindings ran BEFORE the explicit frame was consulted, bound
  // `N`/`I` to `any`, and evaluated `M = N.foo` / `I.length` against a Type
  // Object. Inference is now seeded with the already-bound frame.
  expect(evaluated('function d<...I: [].<uint32>, M: uint32 = I.length>(): uint32 { return M; } String(d.<0, 1, 2>());')).toBe('3');
  expect(evaluated('function d<N: uint32, M: uint32 = N>(): uint32 { return M; } String(d.<4>());')).toBe('4');
});

// ---- B.6 The inference ladder, one function per rung ----
test('B.6: rung one - direct, recursive, and through explicit arguments', () => {
  expect(evaluated('function tup<...Ts>(...xs: Ts): uint32 { return xs.length; } String(tup(1, "a"));')).toBe('2');
  expect(evaluated('function pairUp<T, ...Rest>(p: [T, ...Rest]): uint32 { return p.length; } String(pairUp([1, "a", true]));')).toBe('3');
  expect(evaluated('function lit<...K: [].<string>>(...ks: K): string { return K[1]; } lit("a", "b");')).toBe('b');
});

test('B.6: rung two - trial over a closed pack constraint (F-X closed)', () => {
  expect(evaluated('function maskOf(Bs) { const es = Reflect.getReflection(Bs).elements; const a = es[0].type === type true; const b = es[1].type === type true; return a ? (b ? uint8 : uint16) : (b ? int8 : string); } function withFlags<...Bs extends [2].<boolean>>(m: maskOf(Bs)): uint32 { return Reflect.getReflection(Bs).elements.length; } String(withFlags(1 := uint16));')).toBe('2');
});

// The positive half - a builder WITH `@inverse` binding the pack - is in
// generics/declared-inverses.test.mts (it imports the kit, so it runs as a module).
test('B.6: rung three - a builder with no inverse refuses, NAMING the builder (F-Y closed)', () => {
  expectThrown('function wrapOf(Ts) { return Ts; } function j3<...Ts>(...ps: wrapOf(Ts)): uint32 { return ps.length; } j3(1);', 'wrapOf declares no inverse');
});

test('B.6: a pack refuses to bind from a spread of unknown length (F-Z closed; F-AC retracted)', () => {
  // A spread ARGUMENT is an AssignmentRestElement in the parse tree (a
  // SpreadElement is an array literal's), which is why two correctly placed
  // checks never fired. A truly dynamic array is a parameter of array type;
  // a const initialized from a literal has an extent the checker may know.
  // (F-AC was a probe artifact: an unwrapped NumberValue printed as
  // "[object Object]"; `tup(...dyn)` returns the count.)
  expectThrown('function tup<...Ts>(...xs: Ts): uint32 { return xs.length; } function u(dyn: [].<uint32>): uint32 { return tup(...dyn); }', 'statically known length');
});

test('B.6: a tuple spreads into a pack, and a pack forwards (the idioms F-Z must keep)', () => {
  expect(evaluated('function tup<...Ts>(...xs: Ts): uint32 { return xs.length; } const two: [uint8, string] = [1, "a"]; String(tup(...two));')).toBe('2');
  expect(evaluated('function inner<...Ts>(...xs: Ts): uint32 { return xs.length; } function outer<...Ts>(...xs: Ts): uint32 { return inner(...xs); } String(outer(1, "a", true));')).toBe('3');
});

// ---- B.7 Reflection, library names, generic-typed slots ----
test('B.7: named arguments on user and library generics nest, and a generic slot forwards inference', () => {
  expect(evaluated('type Grid<T = float64, Rows: uint32 = 4, Cols: uint32 = 4> = [].<T>; let g: Grid.<Cols: 8> = []; "ok";')).toBe('ok');
  expect(evaluated("let m: Map.<V: uint8, K: string> = new Map(); m.set('k', 1); String(m.get('k'));")).toBe('1');
  expect(evaluated('function tup<...Ts>(...xs: Ts): uint32 { return xs.length; } let forward: <...Us>(...xs: Us) => uint32 = tup; String(forward(1, "a"));')).toBe('2');
});

test('B.7: the declaration reflects its whole parameter list', () => {
  expect(evaluated(`${STRESS} const tps = Reflect.getReflection(Reflect.typeOf(stress)).signatures[0].typeParameters; tps.map((t) => t.name).join(",");`)).toBe('T,I,N,S,M');
  expect(evaluated(`${STRESS} const tps = Reflect.getReflection(Reflect.typeOf(stress)).signatures[0].typeParameters; String(tps[1].variadic && tps[3].variadic && !tps[2].variadic);`)).toBe('true');
  expect(evaluated('function tup<...Ts>(...xs: Ts): uint32 { return xs.length; } type TupT = <...Us>(...xs: Us) => uint32; String(Reflect.typeOf(tup) === TupT);')).toBe('true');
});
