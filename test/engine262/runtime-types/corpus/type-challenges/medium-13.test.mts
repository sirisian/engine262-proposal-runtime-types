import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 13 (final batch).
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Property-type rewriting, tree traversal, literal predicates, string search,
 * and pairwise/partial combinations. All over getReflection/makeType. Tuple
 * operands are aliases; two ToPrimitive sub-cases diverge and are noted.
 */


// 10969 - Integer - T if it is an integer literal type, else never.
test('medium 10969 - Integer', () => {
  const f = `
    function integer(T) {
      const n = Reflect.getReflection(T);
      return n.kind === 'literal' && Number.isInteger(n.value) ? T : never;
    }`;
  expectBuilderTrue(kit(`${f}\n String(integer(type 1) === type 1);`));
  expectBuilderTrue(kit(`${f}\n String(integer(type 1.1) === never);`));
});

// 28333 - Public Type - drop properties whose name starts with '_'.
test('medium 28333 - Public Type', () => {
  const f = `    function mapProperties(T, f2) { return objectOf(Reflect.getReflection(T).properties.map(f2).filter(p => p !== null)); }
    function publicType(T) { return mapProperties(T, p => typeof p.name === 'string' && p.name.startsWith('_') ? null : p); }`;
  expectBuilderTrue(kit(`${f}\n type X = { a: uint32 }; type Expected = { a: uint32 }; String(publicType(X) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type X = { d: string, _e: string }; type Expected = { d: string }; String(publicType(X) === Expected);`));
});

// 5821 - MapTypes - rewrite property types by from/to rules; multiple hits union.
test('medium 5821 - MapTypes', () => {
  const f = `    function mapTypes(T, rules) {
      const props = Reflect.getReflection(T).properties.map(p => {
        const hits = rules.filter(r => r.from === p.type);
        return hits.length === 0 ? p : { ...p, type: union(hits.map(r => r.to)) };
      });
      return objectOf(props);
    }`;
  expectBuilderTrue(kit(`${f}
    type X = { foo: string, bar: boolean };
    type Expected = { foo: uint32, bar: boolean };
    String(mapTypes(X, [{ from: string, to: uint32 }]) === Expected);
  `));
});

// 3376 - InorderTraversal - the in-order values of a binary tree type.
test('medium 3376 - InorderTraversal', () => {
  const f = `    function field(node, name) { const p = Reflect.getReflection(node).properties.find(x => x.name === name); return p ? p.type : type null; }
    function walk(T) {
      if (T === type null) { return []; }
      return [...walk(field(T, 'left')), field(T, 'val'), ...walk(field(T, 'right'))];
    }
    function inorderTraversal(T) { return tupleOf(walk(T)); }`;
  expectBuilderTrue(kit(`${f}
    type Tree = { val: 1, left: null, right: { val: 3, left: null, right: null } };
    type Expected = [1, 3];
    String(inorderTraversal(Tree) === Expected);
  `));
});

// 21104 - FindAll - every start index at which pattern occurs.
test('medium 21104 - FindAll', () => {
  const f = `    function findAll(s, pattern) {
      if (pattern === '') { return tupleOf([]); }
      const out = [];
      let i = s.indexOf(pattern);
      while (i !== -1) { out.push(literal(i)); i = s.indexOf(pattern, i + 1); }
      return tupleOf(out);
    }`;
  expectBuilderTrue(kit(`${f}\n type Expected = [14]; String(findAll('Collection of TypeScript type challenges', 'Type') === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = [16, 27]; String(findAll('Collection of TypeScript type challenges', 'pe') === Expected);`));
});

// 21106 - Combination key type - space-joined pairs of the given keys.
test('medium 21106 - Combination key type', () => {
  const f = `    function combinationKey(items) {
      const out = [];
      for (let i = 0; i < Number(items.length); i += 1) {
        for (let j = i + 1; j < Number(items.length); j += 1) { out.push(literal(items[i] + ' ' + items[j])); }
      }
      return Reflect.makeType({ kind: 'union', arms: out });
    }`;
  expectBuilderTrue(kit(`${f}
    type Expected = 'cmd ctrl' | 'cmd opt' | 'cmd fn' | 'ctrl opt' | 'ctrl fn' | 'opt fn';
    String(combinationKey(['cmd', 'ctrl', 'opt', 'fn']) === Expected);
  `));
});

// 34857 - Defined Partial Record - the union of every non-empty key subset object.
test('medium 34857 - Defined Partial Record', () => {
  const f = `    function definedPartialRecord(K, V) {
      const keys = Reflect.getReflection(K).arms.map(a => Reflect.getReflection(a).value);
      const combos = [];
      for (let mask = 1; mask < (1 << keys.length); mask += 1) {
        const picked = keys.filter((_, i) => mask & (1 << i));
        combos.push(objectOf(picked.map(k => ({ name: k, type: V, optional: false, readonly: false }))));
      }
      return union(combos);
    }`;
  expectBuilderTrue(kit(`${f}
    type K = 'a' | 'b';
    type Expected = { a: string } | { b: string } | { a: string, b: string };
    String(definedPartialRecord(K, string) === Expected);
  `));
});

// 16259 - ToPrimitive - widen literal properties to their base, recursively.
// Two divergences from the corpus, noted rather than forced:
//  - a numeric literal's base is `number` here, where the corpus writes float64;
//  - the corpus maps a function-typed property to the `Function` type, which is
//    not usable as a type annotation in this engine, so function properties are
//    outside this port.
test('medium 16259 - ToPrimitive (literal widening, no function members)', () => {
  const f = `    function toPrimitive(T) {
      const node = Reflect.getReflection(T);
      if (node.kind === 'literal') { return node.base; }
      if (node.kind === 'object') { return objectOf(node.properties.map(p => ({ ...p, type: toPrimitive(p.type) }))); }
      if (node.kind === 'tuple') { return tupleOf(node.elements.map(e => toPrimitive(e.type))); }
      return T;
    }`;
  expectBuilderTrue(kit(`${f}
    type P = { name: 'Tom', age: 30, married: false, addr: { home: '123456', phone: '13111111111' }, hobbies: ['sing', 'dance'] };
    type Expected = { name: string, age: number, married: boolean, addr: { home: string, phone: string }, hobbies: [string, string] };
    String(toPrimitive(P) === Expected);
  `));
});
