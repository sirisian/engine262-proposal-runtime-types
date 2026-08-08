import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges - the extreme tier, shard 2.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Integer ranges, inversion counting, query-string and comparator logic, an
 * order-independent tag set, matrix indexing, and parameter-list intersection.
 * All ordinary algorithms over interned types. Tuple operands are aliases; a
 * `type []` result is a constructed empty tuple. The Tag challenge's tag key is a
 * Symbol in the corpus; symbol keys are not representable, so a string stand-in
 * key is used (the order-independence and idempotence identities are unaffected).
 */

const L = `function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }`;
const TUP = `
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
function elementTypes(T) { return Reflect.getReflection(T).elements.map(e => e.type); }
function objectOf(props) { return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] }); }
function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
`;

// 734 - Inclusive Range - the integers lo..hi as a tuple; empty if lo > hi.
test('extreme 734 - Inclusive Range', () => {
  const f = `${L}${TUP}\n function inclusiveRange(lo, hi) { const out = []; for (let i = lo; i <= hi; i += 1) { out.push(literal(i)); } return tupleOf(out); }`;
  expectBuilderTrue(`${f}\n type Expected = [5]; String(inclusiveRange(5, 5) === Expected);`);
  expectBuilderTrue(`${f}\n type Expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; String(inclusiveRange(0, 10) === Expected);`);
  expectBuilderTrue(`${f}\n const empty = Reflect.makeType({ kind: 'tuple', elements: [] }); String(inclusiveRange(200, 1) === empty);`);
});

// 31447 - CountReversePairs - count i<j with values[i] > values[j].
test('extreme 31447 - CountReversePairs', () => {
  const f = `${L}
    function countReversePairs(T) {
      const vals = Reflect.getReflection(T).elements.map(e => Reflect.getReflection(e.type).value);
      let count = 0;
      for (let i = 0; i < vals.length; i += 1) { for (let j = i + 1; j < vals.length; j += 1) { if (vals[i] > vals[j]) { count += 1; } } }
      return literal(count);
    }`;
  expectBuilderTrue(`${f}\n type T = [5, 2, 6, 1]; String(countReversePairs(T) === type 4);`);
  expectBuilderTrue(`${f}\n type T = [1, 2, 3, 4]; String(countReversePairs(T) === type 0);`);
  expectBuilderTrue(`${f}\n type T = [-1, -1]; String(countReversePairs(T) === type 0);`);
});

// 274 - Integers Comparator - -1 / 0 / 1 by sign of the difference.
test('extreme 274 - Integers Comparator', () => {
  const f = `${L}\n function comparator(a, b) { return literal(a === b ? 0 : a < b ? -1 : 1); }`;
  expectBuilderTrue(`${f}\n String(comparator(5, 5) === type 0);`);
  expectBuilderTrue(`${f}\n String(comparator(-5, 0) === type -1);`);
  expectBuilderTrue(`${f}\n String(comparator(0, -5) === type 1);`);
});

// 151 - Query String Parser - parse key=value pairs into an object; repeated
// keys collect into a tuple, a bare key is `true`.
test('extreme 151 - Query String Parser', () => {
  const f = `${L}${TUP}
    function parseQueryString(s) {
      if (s === '') { return objectOf([]); }
      const map = new Map();
      for (const part of s.split('&')) {
        const eq = part.indexOf('=');
        const [key, value] = eq === -1 ? [part, true] : [part.slice(0, eq), part.slice(eq + 1)];
        if (!map.has(key)) { map.set(key, []); }
        map.get(key).push(value);
      }
      return objectOf([...map].map(([key, values]) => ({ name: key, type: values.length === 1 ? literal(values[0]) : tupleOf(values.map(v => literal(v))), optional: false, readonly: false })));
    }`;
  expectBuilderTrue(`${f}\n const empty = Reflect.makeType({ kind: 'object', properties: [], indexSignatures: [] }); String(parseQueryString('') === empty);`);
  expectBuilderTrue(`${f}\n type Expected = { a: '1', b: '2' }; String(parseQueryString('a=1&b=2') === Expected);`);
  expectBuilderTrue(`${f}\n type Expected = { a: ['1', '2'] }; String(parseQueryString('a=1&a=2') === Expected);`);
});

// 925 - Assert Array Index - the element type at an index (matrix rows too).
test('extreme 925 - Assert Array Index', () => {
  const f = `${TUP}\n function at(T, i) { return elementTypes(T)[i]; }`;
  expectBuilderTrue(`${f}\n type Matrix = [[1, 2], [3, 4]]; type Expected = [3, 4]; String(at(Matrix, 1) === Expected);`);
  expectBuilderTrue(`${f}\n type Matrix = [[1, 2], [3, 4]]; String(at(at(Matrix, 1), 0) === type 3);`);
});

// 697 - Tag - attach an order-independent, idempotent tag set to a type.
test('extreme 697 - Tag', () => {
  const f = `${L}${TUP}
    const TAGS = '__tags';
    function literalValues(T) { const n = Reflect.getReflection(T); return (n.kind === 'union' ? n.arms : [T]).map(a => Reflect.getReflection(a).value); }
    function tag(T, name) {
      const existing = Reflect.getReflection(T).properties.find(p => p.name === TAGS);
      const names = existing === undefined ? [] : literalValues(existing.type).map(String);
      const merged = [...new Set([...names, name])].sort();
      return objectOf([
        ...Reflect.getReflection(T).properties.filter(p => p.name !== TAGS),
        { name: TAGS, type: union(merged.map(n => literal(n))), optional: true, readonly: true },
      ]);
    }
    function unTag(T) { return objectOf(Reflect.getReflection(T).properties.filter(p => p.name !== TAGS)); }`;
  // order does not matter
  expectBuilderTrue(`${f}\n type I = { foo: string }; String(tag(tag(I, 'a'), 'b') === tag(tag(I, 'b'), 'a'));`);
  // tagging twice does not change the type
  expectBuilderTrue(`${f}\n type I = { foo: string }; String(tag(tag(I, 'a'), 'a') === tag(I, 'a'));`);
  // untag recovers the original
  expectBuilderTrue(`${f}\n type I = { foo: string }; String(unTag(tag(tag(I, 'c'), 'b')) === I);`);
});

// 31997 - Parameter Intersection - merge two parameter tuples position-wise,
// intersecting where both are present.
test('extreme 31997 - Parameter Intersection', () => {
  const f = `${TUP}
    function all(members) { return Reflect.makeType({ kind: 'intersection', members }); }
    function paramIntersection(A, B) {
      const a = elementTypes(A), b = elementTypes(B);
      const n = Math.max(a.length, b.length);
      const out = [];
      for (let i = 0; i < n; i += 1) { out.push(a[i] !== undefined && b[i] !== undefined ? all([a[i], b[i]]) : (a[i] ?? b[i])); }
      return tupleOf(out);
    }`;
  expectBuilderTrue(`${f}\n type A = [{ x: 1 }]; type B = [{ y: 2 }]; type Expected = [{ x: 1 } & { y: 2 }]; String(paramIntersection(A, B) === Expected);`);
  expectBuilderTrue(`${f}\n type A = [{ x: 1 }, string]; type B = [{ y: 2 }]; type Expected = [{ x: 1 } & { y: 2 }, string]; String(paramIntersection(A, B) === Expected);`);
});
