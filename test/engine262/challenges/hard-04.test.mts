import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges — the hard tier, shard 4.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Enum-object generation (readonly), key predicates, object merging and
 * entries, union member replacement, run-length coding, and tuple takes. All
 * over getReflection/makeType and ordinary JS. Tuple operands are aliases.
 */

const L = `function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }`;
const TUP = `
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
function elementTypes(T) { return Reflect.getReflection(T).elements.map(e => e.type); }
function objectOf(props) { return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] }); }
function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
function arms(T) { const n = Reflect.getReflection(T); return n.kind === 'union' ? n.arms : [T]; }
`;

// 472 · Tuple to Enum Object — a readonly enum keyed by the capitalized names,
// valued by the name (or the index, with the numeric flag).
test('hard 472 · Tuple to Enum Object', () => {
  const f = `${L}${TUP}
    function enumObject(names, numeric = false) {
      return objectOf(names.map((name, i) => ({ name: name[0].toUpperCase() + name.slice(1), type: literal(numeric ? i : name), optional: false, readonly: true })));
    }`;
  expectBuilderTrue(`${f}\n type Expected = {}; String(enumObject([]) === Expected);`);
  expectBuilderTrue(`${f}\n type Expected = { readonly MacOS: 'macOS', readonly Windows: 'Windows', readonly Linux: 'Linux' }; String(enumObject(['macOS', 'Windows', 'Linux']) === Expected);`);
  expectBuilderTrue(`${f}\n type Expected = { readonly MacOS: 0, readonly Windows: 1, readonly Linux: 2 }; String(enumObject(['macOS', 'Windows', 'Linux'], true) === Expected);`);
});

// 2857 · IsRequiredKey — the key (or all keys, if a union) is required.
test('hard 2857 · IsRequiredKey', () => {
  const f = `${TUP}
    function isRequiredKey(T, K) {
      const keys = new Set(arms(K).map(a => Reflect.getReflection(a).value));
      const props = Reflect.getReflection(T).properties.filter(p => keys.has(p.name));
      return props.length === keys.size && props.length > 0 && props.every(p => !p.optional) ? type true : type false;
    }`;
  expectBuilderTrue(`${f}\n type X = { a: uint32, b?: string }; String(isRequiredKey(X, type 'a') === type true);`);
  expectBuilderTrue(`${f}\n type X = { a: uint32, b?: string }; String(isRequiredKey(X, type 'b') === type false);`);
  expectBuilderTrue(`${f}\n type X = { a: uint32, b?: string }; type K = 'b' | 'a'; String(isRequiredKey(X, K) === type false);`);
});

// 2949 · ObjectFromEntries — a tuple of [key, value] tuples to an object.
test('hard 2949 · ObjectFromEntries', () => {
  const f = `${TUP}
    function objectFromEntries(T) {
      const entries = Reflect.getReflection(T).elements.map(e => {
        const pair = Reflect.getReflection(e.type).elements;
        return { name: Reflect.getReflection(pair[0].type).value, type: pair[1].type, optional: false, readonly: false };
      });
      return objectOf(entries);
    }`;
  expectBuilderTrue(`${f}
    type Entries = [['name', string], ['age', float64], ['locations', [].<string> | null]];
    type Expected = { name: string, age: float64, locations: [].<string> | null };
    String(objectFromEntries(Entries) === Expected);
  `);
});

// 9160 · Assign — merge base with each source; later keys win.
test('hard 9160 · Assign', () => {
  const f = `${TUP}
    function assign(base, sources) {
      const map = new Map();
      for (const p of Reflect.getReflection(base).properties) { map.set(p.name, p); }
      for (const s of sources) { for (const p of Reflect.getReflection(s).properties) { map.set(p.name, p); } }
      return objectOf([...map.values()]);
    }`;
  expectBuilderTrue(`${f}\n type S1 = { a: 'a' }; const empty = Reflect.makeType({ kind: 'object', properties: [], indexSignatures: [] }); type Expected = { a: 'a' }; String(assign(empty, [S1]) === Expected);`);
  expectBuilderTrue(`${f}\n type Base = { a: 'a', b: 'b' }; type S1 = { a: 1 }; type S2 = { c: 'c' }; type Expected = { a: 1, b: 'b', c: 'c' }; String(assign(Base, [S1, S2]) === Expected);`);
});

// 13580 · Replace Union — replace union arms per a list of [from, to] pairs.
test('hard 13580 · Replace Union', () => {
  const f = `${TUP}
    function unionReplace(T, pairs) {
      return union(arms(T).map(arm => { const hit = pairs.find(([from]) => from === arm); return hit ? hit[1] : arm; }));
    }`;
  expectBuilderTrue(`${f}\n type T = float64 | string; type Expected = float64 | null; String(unionReplace(T, [[string, type null]]) === Expected);`);
  // an unmatched pair leaves the union unchanged
  expectBuilderTrue(`${f}\n type T = float64 | string; type Expected = float64 | null; String(unionReplace(T, [[string, type null], [Date, Function]]) === Expected);`);
});

// 14188 · Run-length encoding — encode and decode round-trip.
test('hard 14188 · Run-length encoding', () => {
  const enc = `${L}
    function encode(s) {
      const runs = [];
      for (const ch of s) { const last = runs[runs.length - 1]; if (last && last[0] === ch) { last[1] += 1; } else { runs.push([ch, 1]); } }
      return literal(runs.map(([ch, n]) => (n === 1 ? '' : n) + ch).join(''));
    }`;
  const dec = `${L}
    function decode(s) { return literal(s.replace(/(\\d*)(\\D)/g, (m, n, ch) => ch.repeat(n === '' ? 1 : Number(n)))); }`;
  expectBuilderTrue(`${enc}\n String(encode('AAABCCXXXXXXY') === type '3AB2C6XY');`);
  expectBuilderTrue(`${dec}\n String(decode('3AB2C6XY') === type 'AAABCCXXXXXXY');`);
});

// 25747 · IsNegativeNumber — a negative number literal; non-literals are never.
test('hard 25747 · IsNegativeNumber', () => {
  const f = `
    function isNegativeNumber(T) {
      const n = Reflect.getReflection(T);
      if (n.kind !== 'literal' || typeof n.value !== 'number') { return never; }
      return n.value < 0 ? type true : type false;
    }`;
  expectBuilderTrue(`${f}\n String(isNegativeNumber(type -1) === type true);`);
  expectBuilderTrue(`${f}\n String(isNegativeNumber(type 0) === type false);`);
  expectBuilderTrue(`${f}\n String(isNegativeNumber(float64) === never);`);
  // a union of negatives is not a single literal, so never
  expectBuilderTrue(`${f}\n type U = -1 | -2; String(isNegativeNumber(U) === never);`);
});

// 34286 · Take Elements — the first n (or last -n) elements of a tuple.
test('hard 34286 · Take Elements', () => {
  const f = `${TUP}\n function take(n, T) { const els = elementTypes(T); return tupleOf(n >= 0 ? els.slice(0, n) : els.slice(n)); }`;
  expectBuilderTrue(`${f}\n type T = [1, 2, 3]; type Expected = [1, 2]; String(take(2, T) === Expected);`);
  expectBuilderTrue(`${f}\n type T = [1, 2, 3]; type Expected = [2, 3]; String(take(-2, T) === Expected);`);
  // take 0 is a constructed empty tuple
  expectBuilderTrue(`${f}\n type T = [1, 2, 3]; String(take(0, T) === Reflect.makeType({ kind: 'tuple', elements: [] }));`);
});
