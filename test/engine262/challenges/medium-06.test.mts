import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges — the medium tier, shard 6.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Recursion over reflected structure (Deep Readonly), property filtering by
 * value type (===, not assignability), object-to-union projection, and the
 * identity-based tuple operations the corpus repeatedly notes need `===` rather
 * than a subtype test. Interning makes identity a language operator, so these
 * are direct. Tuple operands are aliases (the `type [...]` limitation).
 */

const L = `function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }`;
const TUP = `
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
function elementTypes(T) { return Reflect.getReflection(T).elements.map(e => e.type); }
function objectOf(props) { return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] }); }
`;

// 9 · Deep Readonly — mark every property readonly, recursing into object-typed
// properties. Now expressible: the readonly flag exists and reflection recurses.
test('medium 9 · Deep Readonly', () => {
  const f = `
    function deepReadonly(T) {
      const n = Reflect.getReflection(T);
      if (n.kind === 'object') {
        return Reflect.makeType({ kind: 'object', properties: n.properties.map(p => ({ ...p, readonly: true, type: deepReadonly(p.type) })), indexSignatures: [] });
      }
      if (n.kind === 'union') {
        return Reflect.makeType({ kind: 'union', arms: n.arms.map(deepReadonly) });
      }
      return T;
    }`;
  expectBuilderTrue(`${f}
    type X = { a: string, nested: { b: uint32, deep: { c: boolean } } };
    type Expected = { readonly a: string, readonly nested: { readonly b: uint32, readonly deep: { readonly c: boolean } } };
    String(deepReadonly(X) === Expected);
  `);
  // distributes over a union
  expectBuilderTrue(`${f}
    type U = { a: string } | { b: uint32 };
    type Expected = { readonly a: string } | { readonly b: uint32 };
    String(deepReadonly(U) === Expected);
  `);
});

// 2595 · PickByType — keep the properties whose type is exactly U.
test('medium 2595 · PickByType', () => {
  expectBuilderTrue(`${TUP}
    function pickByType(T, U) { return objectOf(Reflect.getReflection(T).properties.filter(p => p.type === U)); }
    type Model = { name: string, count: uint32, isReadonly: boolean, isEnable: boolean };
    type Expected = { isReadonly: boolean, isEnable: boolean };
    String(pickByType(Model, boolean) === Expected);
  `);
});

// 2852 · OmitByType — drop the properties whose type is exactly U.
test('medium 2852 · OmitByType', () => {
  expectBuilderTrue(`${TUP}
    function omitByType(T, U) { return objectOf(Reflect.getReflection(T).properties.filter(p => p.type !== U)); }
    type Model = { name: string, isReadonly: boolean, isEnable: boolean, count: uint32 };
    type Expected = { name: string, count: uint32 };
    String(omitByType(Model, boolean) === Expected);
  `);
});

// 2946 · ObjectEntries — a union of [key, value] tuples, one per property.
test('medium 2946 · ObjectEntries', () => {
  expectBuilderTrue(`${L}${TUP}
    function objectEntries(T) {
      const entries = Reflect.getReflection(T).properties.map(p => tupleOf([literal(p.name), p.type]));
      return Reflect.makeType({ kind: 'union', arms: entries });
    }
    type Model = { name: string, age: uint32 };
    type Expected = ['name', string] | ['age', uint32];
    String(objectEntries(Model) === Expected);
  `);
});

// 5153 · IndexOf — the index of the first element type identical to U, or -1.
// The corpus note: identity, not assignability (1 does not match uint32).
test('medium 5153 · IndexOf', () => {
  const f = `${L}\n function indexOf(T, U) { return literal(Reflect.getReflection(T).elements.findIndex(e => e.type === U)); }`;
  expectBuilderTrue(`${f}\n type T = [1, 2, 3]; String(indexOf(T, type 2) === type 1);`);
  expectBuilderTrue(`${f}\n type T = [0, 0, 0]; String(indexOf(T, type 2) === type -1);`);
  // identity: a literal 1 does not match uint32
  expectBuilderTrue(`${f}\n type T = [string, 1, uint32, 'a']; String(indexOf(T, uint32) === type 2);`);
});

// 5360 · Unique — dedupe element types by identity, keeping first occurrence.
test('medium 5360 · Unique', () => {
  const f = `${TUP}
    function unique(T) {
      const seen = [];
      for (const e of Reflect.getReflection(T).elements) { if (!seen.includes(e.type)) seen.push(e.type); }
      return tupleOf(seen);
    }`;
  expectBuilderTrue(`${f}\n type T = [1, 1, 2, 2, 3, 3]; type Expected = [1, 2, 3]; String(unique(T) === Expected);`);
  expectBuilderTrue(`${f}\n type T = [1, 'a', 2, 'b', 2, 'a']; type Expected = [1, 'a', 2, 'b']; String(unique(T) === Expected);`);
});

// 5117 · Without — drop from T every element type present in U (a value or tuple).
test('medium 5117 · Without', () => {
  const f = `${TUP}
    function without(T, U) {
      const un = Reflect.getReflection(U);
      const drop = new Set(un.kind === 'tuple' ? un.elements.map(e => e.type) : [U]);
      return tupleOf(elementTypes(T).filter(t => !drop.has(t)));
    }`;
  expectBuilderTrue(`${f}\n type T = [1, 2]; type U = [1]; type Expected = [2]; String(without(T, U) === Expected);`);
  expectBuilderTrue(`${f}\n type T = [1, 2, 4, 1, 5]; type U = [1, 2]; type Expected = [4, 5]; String(without(T, U) === Expected);`);
});

// 5140 · Trunc — the integer part of a number/string as a string literal type.
test('medium 5140 · Trunc', () => {
  const f = `${L}
    function trunc(n) { const s = String(n); const i = s.indexOf('.'); return literal(i === -1 ? s : (s.slice(0, i) || '0')); }`;
  expectBuilderTrue(`${f}\n String(trunc(12.345) === type '12');`);
  expectBuilderTrue(`${f}\n String(trunc(-5.1) === type '-5');`);
  expectBuilderTrue(`${f}\n String(trunc('.3') === type '0');`);
});

// 8640 · Number Range — the inclusive integer range as a union of literal types.
test('medium 8640 · Number Range', () => {
  const f = `${L}
    function numberRange(lo, hi) {
      const arms = [];
      for (let i = lo; i <= hi; i += 1) { arms.push(literal(i)); }
      return Reflect.makeType({ kind: 'union', arms });
    }`;
  expectBuilderTrue(`${f}\n type Expected = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; String(numberRange(2, 9) === Expected);`);
  expectBuilderTrue(`${f}\n type Expected = 0 | 1 | 2; String(numberRange(0, 2) === Expected);`);
});
