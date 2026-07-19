import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges — the medium tier, shard 9.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * The distinction between identity (===) and assignability (isAssignable) is the
 * theme here: Appear-only-once and Filter/Replace-First sit on opposite sides of
 * it, and the corpus notes exactly that. Also matrix diagonal, union-merge, and
 * bounded recursion. Tuple operands are aliases (the `type [...]` limitation).
 */

const L = `function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }`;
const TUP = `
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
function elementTypes(T) { return Reflect.getReflection(T).elements.map(e => e.type); }
function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
`;

// 9898 · Appear only once — elements whose first and last index agree (identity).
test('medium 9898 · Appear only once', () => {
  const f = `${TUP}
    function findEles(T) { const ts = elementTypes(T); return tupleOf(ts.filter(t => ts.indexOf(t) === ts.lastIndexOf(t))); }`;
  expectBuilderTrue(`${f}\n type T = [1, 2, 2, 3, 3, 4, 5, 6, 6, 6]; type Expected = [1, 4, 5]; String(findEles(T) === Expected);`);
  // identity: a literal 1 is not a duplicate of uint32
  expectBuilderTrue(`${f}\n type T = [1, 2, uint32]; type Expected = [1, 2, uint32]; String(findEles(T) === Expected);`);
  expectBuilderTrue(`${f}\n type T = [1, 2, uint32, uint32]; type Expected = [1, 2]; String(findEles(T) === Expected);`);
});

// 18220 · Filter — keep elements ASSIGNABLE to U (a value or a union).
test('medium 18220 · Filter', () => {
  const f = `${TUP}\n function filter(T, U) { return tupleOf(elementTypes(T).filter(t => Reflect.isAssignable(t, U))); }`;
  expectBuilderTrue(`${f}\n type T = [0, 1, 2]; type Expected = [2]; String(filter(T, type 2) === Expected);`);
  expectBuilderTrue(`${f}\n type T = [0, 1, 2]; type U = 0 | 1; type Expected = [0, 1]; String(filter(T, U) === Expected);`);
});

// 25170 · Replace First — replace the first element ASSIGNABLE to S with R.
test('medium 25170 · Replace First', () => {
  const f = `${TUP}
    function replaceFirst(T, S, R) {
      const els = elementTypes(T);
      const i = els.findIndex(t => Reflect.isAssignable(t, S));
      return tupleOf(i === -1 ? els : els.map((t, j) => j === i ? R : t));
    }`;
  expectBuilderTrue(`${f}\n type T = [1, 2, 3]; type Expected = [1, 2, 4]; String(replaceFirst(T, type 3, type 4) === Expected);`);
  // 'two' is assignable to string, so it is the first match
  expectBuilderTrue(`${f}\n type T = [1, 'two', 3]; type Expected = [1, 2, 3]; String(replaceFirst(T, string, type 2) === Expected);`);
  // no match leaves the tuple unchanged
  expectBuilderTrue(`${f}\n type T = ['six', 'eight', 'ten']; type Expected = ['six', 'eight', 'ten']; String(replaceFirst(T, type 'eleven', type 'twelve') === Expected);`);
});

// 35191 · Trace — the union of a square matrix's main diagonal.
test('medium 35191 · Trace', () => {
  const f = `${TUP}\n function trace(M) { const rows = elementTypes(M); return union(rows.map((r, i) => elementTypes(r)[i])); }`;
  expectBuilderTrue(`${f}\n type M = [[1, 2], [3, 4]]; type Expected = 1 | 4; String(trace(M) === Expected);`);
  expectBuilderTrue(`${f}\n type M = [[0, 1, 1], [2, 0, 2], [3, 3, 0]]; type Expected = 0; String(trace(M) === Expected);`);
  expectBuilderTrue(`${f}\n type M = [['a', 'b', ''], ['c', '', ''], ['d', 'e', 'f']]; type Expected = 'a' | '' | 'f'; String(trace(M) === Expected);`);
});

// 27932 · MergeAll — merge a tuple of objects; same-key value types union.
test('medium 27932 · MergeAll', () => {
  const f = `${TUP}
    function mergeAll(T) {
      const byKey = new Map();
      for (const el of Reflect.getReflection(T).elements) {
        for (const p of Reflect.getReflection(el.type).properties) {
          if (!byKey.has(p.name)) { byKey.set(p.name, []); }
          byKey.get(p.name).push(p.type);
        }
      }
      const props = [...byKey].map(([name, types]) => ({ name, type: union(types), optional: false, readonly: false }));
      return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] });
    }`;
  expectBuilderTrue(`${f}\n type T = [{ a: 1 }, { a: 2 }]; type Expected = { a: 1 | 2 }; String(mergeAll(T) === Expected);`);
  expectBuilderTrue(`${f}\n type T = [{ a: string }, { a: string }]; type Expected = { a: string }; String(mergeAll(T) === Expected);`);
  expectBuilderTrue(`${f}\n type T = [{}, { a: string }]; type Expected = { a: string }; String(mergeAll(T) === Expected);`);
});

// 35252 · IsAlphabet — a single alphabetic character.
test('medium 35252 · IsAlphabet', () => {
  const f = 'function isAlphabet(s) { return /^[a-zA-Z]$/.test(s) ? type true : type false; }';
  expectBuilderTrue(`${f}\n String(isAlphabet('A') === type true);`);
  expectBuilderTrue(`${f}\n String(isAlphabet('z') === type true);`);
  expectBuilderTrue(`${f}\n String(isAlphabet('9') === type false);`);
});

// 2257 · MinusOne — n - 1, as a literal number type. Ordinary JS math.
test('medium 2257 · MinusOne', () => {
  const f = `${L}\n function minusOne(n) { return literal(n - 1); }`;
  expectBuilderTrue(`${f}\n String(minusOne(1) === type 0);`);
  expectBuilderTrue(`${f}\n String(minusOne(55) === type 54);`);
});

// 3243 · FlattenDepth — flatten nested tuples to a bounded depth.
test('medium 3243 · FlattenDepth', () => {
  const f = `${TUP}
    function flat(elements, d) {
      return d === 0 ? elements : elements.flatMap(e => {
        const r = Reflect.getReflection(e.type);
        return r.kind === 'tuple' ? flat(r.elements, d - 1) : [e];
      });
    }
    function flattenDepth(T, d) { return tupleOf(flat(Reflect.getReflection(T).elements, d ?? 1).map(e => e.type)); }`;
  expectBuilderTrue(`${f}\n type T = [1, [2]]; type Expected = [1, 2]; String(flattenDepth(T) === Expected);`);
  // depth 2 leaves the innermost [5] wrapped once
  expectBuilderTrue(`${f}\n type T = [1, 2, [3, 4], [[[5]]]]; type Expected = [1, 2, 3, 4, [5]]; String(flattenDepth(T, 2) === Expected);`);
});
