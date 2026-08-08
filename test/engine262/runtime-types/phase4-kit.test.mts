import { test } from 'vitest';
import { expectBuilderTrue } from './corpus/type-challenges/harness.mts';

/**
 * Phase 4 — the std:types builder kit.
 * Source: proposal spec, the standard-kit annex.
 *
 * The spec is explicit that the kit is "roughly two hundred lines of ordinary
 * evaluable code" over the core primitives, ships as source, and "a codebase
 * that cannot assume the module can polyfill it verbatim" — no engine magic. So
 * the kit is not built as engine intrinsics; it is written HERE as source over
 * the primitives now in place (keyof from Phase 2; getReflection, makeType,
 * isAssignable from Phase 3/4), exactly as the spec's own definitions are, e.g.
 *   export function partial(T) { return mapProperties(T, p => ({ ...p, optional: true })); }
 *
 * getReflection was implemented this phase as the enabling primitive: it is the
 * read side (the inverse of makeType), without which mapProperties/arms/keysOf
 * and most of the kit cannot be expressed. The round trip
 * makeType(getReflection(T)) === T is verified in phase4-reflection below.
 *
 * The kit's obligation, per the spec: "Where the kit and the core describe one
 * operation, they must agree" — keysOf computes what keyof specifies. Each helper
 * is asserted against that operation. Assertions are type identities via
 * interning; where an operator (keyof) is needed on the expected side, it is used
 * in TYPE position (an alias), since type operators are not expression-position
 * forms in the current parser.
 */

// The kit, as source over the primitives. Prepended to each builder program.
const KIT = `
// --- foundations ---
function arms(T) { const n = Reflect.getReflection(T); return n.kind === 'union' ? n.arms : [T]; }
function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }
function prop(name, type) { return { name: name, type: type, optional: false }; }
function objectOf(props) { return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] }); }
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
function elementTypes(T) { return Reflect.getReflection(T).elements.map(e => e.type); }
function mapProperties(T, f) { return objectOf(Reflect.getReflection(T).properties.map(f)); }
function keysOf(T) { return union(Reflect.getReflection(T).properties.map(p => literal(p.name))); }
// --- object utilities ---
function partial(T) { return mapProperties(T, p => ({ ...p, optional: true })); }
function required(T) { return mapProperties(T, p => ({ ...p, optional: false })); }
function pick(T, K) { const want = new Set(arms(K).map(a => Reflect.getReflection(a).value)); return objectOf(Reflect.getReflection(T).properties.filter(p => want.has(p.name))); }
function omit(T, K) { const drop = new Set(arms(K).map(a => Reflect.getReflection(a).value)); return objectOf(Reflect.getReflection(T).properties.filter(p => !drop.has(p.name))); }
// --- union filters ---
function exclude(T, U) { return union(arms(T).filter(a => !Reflect.isAssignable(a, U))); }
function extract(T, U) { return union(arms(T).filter(a => Reflect.isAssignable(a, U))); }
`;

function kit(program: string): string {
  return `${KIT}\n${program}`;
}

// --- the kit agrees with the core it is written over ---

test('kit · keysOf computes keyof (the agreement obligation)', () => {
  expectBuilderTrue(kit(`
    type T = { a: uint8, b: string, c: boolean };
    type Keys = keyof T;
    String(keysOf(T) === Keys);
  `));
});

test('kit · union(arms(T)) round-trips a union', () => {
  expectBuilderTrue(kit(`
    type U = 'a' | 'b' | 'c';
    String(union(arms(U)) === U);
  `));
});

test('kit · arms normalizes a non-union to a singleton', () => {
  expectBuilderTrue(kit(`
    type K = 'x';
    String(arms(K).length === 1 && arms(K)[0] === K);
  `));
});

test('kit · literal builds a literal type from a value', () => {
  expectBuilderTrue(kit(`
    type E = 'hello';
    String(literal('hello') === E);
  `));
});

test('kit · elementTypes ° tupleOf round-trips a tuple', () => {
  expectBuilderTrue(kit(`
    type T = [uint8, string, boolean];
    String(tupleOf(elementTypes(T)) === T);
  `));
});

// --- challenges the kit ports in builder form ---

// 4 · Pick — the corpus's std block asserts std.pick(Todo, K) === TodoPreview.
test('challenge 4 · Pick (kit builder form)', () => {
  expectBuilderTrue(kit(`
    type Todo = { title: string, description: string, completed: boolean };
    type K = 'title' | 'completed';
    type TodoPreview = { title: string, completed: boolean };
    String(pick(Todo, K) === TodoPreview);
  `));
});

// 3 · Omit — std.omit(Todo, K).
test('challenge 3 · Omit (kit builder form)', () => {
  // The corpus writes `type 'description'`; the type operator is not an
  // expression form, so the single key is provided as an alias.
  expectBuilderTrue(kit(`
    type Todo = { title: string, description: string, completed: boolean };
    type Drop = 'description';
    type Expected = { title: string, completed: boolean };
    String(omit(Todo, Drop) === Expected);
  `));
  // omitting two keys
  expectBuilderTrue(kit(`
    type Todo = { title: string, description: string, completed: boolean };
    type Drop = 'description' | 'completed';
    type Expected = { title: string };
    String(omit(Todo, Drop) === Expected);
  `));
});

// 43 · Exclude — the whole challenge is union filtering; exclude is the kit form.
test('challenge 43 · Exclude (kit builder form)', () => {
  expectBuilderTrue(kit(`
    type T = 'a' | 'b' | 'c';
    type U = 'a';
    type Expected = 'b' | 'c';
    String(exclude(T, U) === Expected);
  `));
  // excluding two arms
  expectBuilderTrue(kit(`
    type T = 'a' | 'b' | 'c';
    type U = 'a' | 'b';
    type Expected = 'c';
    String(exclude(T, U) === Expected);
  `));
  // excluding everything is never
  expectBuilderTrue(kit(`
    type T = 'a';
    type U = 'a';
    String(exclude(T, U) === never);
  `));
});

// 7 · Readonly — the kit's readonly marks every property readonly. The object
// record now carries a readonly flag (implemented in Phase 5), so this is
// expressible and asserted here.
test('challenge 7 · Readonly (kit builder form)', () => {
  expectBuilderTrue(kit(`
    function readonly(T) { return Reflect.makeType({ kind: 'object', properties: Reflect.getReflection(T).properties.map(p => ({ ...p, readonly: true })), indexSignatures: [] }); }
    type Todo = { title: string, completed: boolean };
    type Expected = { readonly title: string, readonly completed: boolean };
    String(readonly(Todo) === Expected);
  `));
});

// 10 · Tuple to Union — union of a tuple's element types.
test('challenge 10 · Tuple to Union (kit builder form)', () => {
  expectBuilderTrue(kit(`
    type T = [123, '456', true];
    type Expected = 123 | '456' | true;
    String(union(elementTypes(T)) === Expected);
  `));
  // a one-element tuple gives a one-arm union, which interns to the arm
  expectBuilderTrue(kit(`
    type T = [123];
    type Expected = 123;
    String(union(elementTypes(T)) === Expected);
  `));
});
