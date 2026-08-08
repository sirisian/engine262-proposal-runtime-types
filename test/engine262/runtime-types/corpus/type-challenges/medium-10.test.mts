import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 10 (the harder combinatorial ones).
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Permutations, combinations, cartesian product, subsequences: in the erased
 * language these are the challenges that fight the recursion limit hardest; in
 * the builder they are ordinary array algorithms that produce a union of tuple
 * types. Also function-argument reversal and recursive object nesting. Tuple
 * operands are aliases; where an expected union contains `type []` it is a
 * dynamic array, so a constructed empty tuple is used instead (noted inline).
 */

const L = `function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }`;
const TUP = `
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
function elementTypes(T) { return Reflect.getReflection(T).elements.map(e => e.type); }
function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
function arms(T) { const n = Reflect.getReflection(T); return n.kind === 'union' ? n.arms : [T]; }
`;

// 296 - Permutation - a union to the union of its element permutations (tuples).
test('medium 296 - Permutation', () => {
  const f = `${TUP}
    function permute(items) {
      if (items.length <= 1) { return [items]; }
      const out = [];
      for (let i = 0; i < items.length; i += 1) {
        const rest = [...items.slice(0, i), ...items.slice(i + 1)];
        for (const p of permute(rest)) { out.push([items[i], ...p]); }
      }
      return out;
    }
    function permutation(U) { return union(permute(arms(U)).map(p => tupleOf(p))); }`;
  expectBuilderTrue(`${f}
    type U = 'A' | 'B' | 'C';
    type Expected = ['A','B','C'] | ['A','C','B'] | ['B','A','C'] | ['B','C','A'] | ['C','A','B'] | ['C','B','A'];
    String(permutation(U) === Expected);
  `);
  // a single member permutes to the one-element tuple
  expectBuilderTrue(`${f}
    type U = 'A';
    type Expected = ['A'];
    String(permutation(U) === Expected);
  `);
  // NOTE: the corpus also asserts permutation(boolean) === [false,true] | [true,false],
  // which relies on `boolean` decomposing into `false | true`. In this type system
  // `boolean` is a distinct primitive, NOT the union of its literals (the spec's
  // literal rule makes `true | false` a subtype of `boolean`, deliberately not the
  // reverse), so `arms(boolean)` is `[boolean]` and that assertion does not hold
  // here. The union-of-literals form is what decomposes, so:
  expectBuilderTrue(`${f}
    type U = false | true;
    type Expected = [false, true] | [true, false];
    String(permutation(U) === Expected);
  `);
});

// 21220 - Permutations of Tuple - the same over a tuple's element types.
test('medium 21220 - Permutations of Tuple', () => {
  const f = `${TUP}
    function permute(items) {
      if (items.length <= 1) { return [items]; }
      const out = [];
      for (let i = 0; i < items.length; i += 1) {
        const rest = [...items.slice(0, i), ...items.slice(i + 1)];
        for (const p of permute(rest)) { out.push([items[i], ...p]); }
      }
      return out;
    }
    function permutationsOfTuple(T) { return union(permute(elementTypes(T)).map(p => tupleOf(p))); }`;
  expectBuilderTrue(`${f}
    type T = [1, 2, 3];
    type Expected = [1,2,3] | [1,3,2] | [2,1,3] | [2,3,1] | [3,1,2] | [3,2,1];
    String(permutationsOfTuple(T) === Expected);
  `);
});

// 27862 - CartesianProduct - pairs from two unions.
test('medium 27862 - CartesianProduct', () => {
  const f = `${TUP}
    function cartesianProduct(A, B) {
      const a = arms(A), b = arms(B);
      const out = [];
      for (const x of a) { for (const y of b) { out.push(tupleOf([x, y])); } }
      return union(out);
    }`;
  expectBuilderTrue(`${f}
    type A = 1 | 2; type B = 'a' | 'b';
    type Expected = [1, 'a'] | [1, 'b'] | [2, 'a'] | [2, 'b'];
    String(cartesianProduct(A, B) === Expected);
  `);
  // never as a union member contributes nothing (arms of never is empty)
  expectBuilderTrue(`${f}
    type A = 1 | 2; type B = 'a' | never;
    type Expected = [1, 'a'] | [2, 'a'];
    String(cartesianProduct(A, B) === Expected);
  `);
});

// 8987 - Subsequence - the power set of a tuple, as a union of tuples. The
// empty subsequence is a constructed empty tuple (an expected `type []` would be
// a dynamic array, a different type).
test('medium 8987 - Subsequence', () => {
  const f = `${TUP}
    function go(els) { return els.length === 0 ? [[]] : go(els.slice(1)).flatMap(rest => [rest, [els[0], ...rest]]); }
    function subsequence(T) { return union(go(elementTypes(T)).map(s => tupleOf(s))); }`;
  expectBuilderTrue(`${f}
    type T = [1, 2];
    type P1 = [1]; type P2 = [2]; type P3 = [1, 2];
    const expected = union([tupleOf([]), P1, P2, P3]);
    String(subsequence(T) === expected);
  `);
});

// 4260 - AllCombinations - every ordered combination of a string's characters.
test('medium 4260 - AllCombinations', () => {
  const f = `${L}
    function allCombinations(s) {
      const result = new Set(['']);
      function perm(prefix, remaining) {
        for (let i = 0; i < remaining.length; i += 1) {
          const next = prefix + remaining[i];
          result.add(next);
          perm(next, [...remaining.slice(0, i), ...remaining.slice(i + 1)]);
        }
      }
      perm('', [...s]);
      return Reflect.makeType({ kind: 'union', arms: [...result].map(x => literal(x)) });
    }`;
  expectBuilderTrue(`${f}\n String(allCombinations('') === type '');`);
  expectBuilderTrue(`${f}\n type Expected = '' | 'A'; String(allCombinations('A') === Expected);`);
  expectBuilderTrue(`${f}\n type Expected = '' | 'A' | 'B' | 'AB' | 'BA'; String(allCombinations('AB') === Expected);`);
});

// 3196 - Flip Arguments - reverse a function type's parameter list.
test('medium 3196 - Flip Arguments', () => {
  const f = `
    function fnType(params, ret) { return Reflect.makeType({ kind: 'function', signatures: [{ parameters: params.map(t => ({ type: t })), return: { type: ret } }] }); }
    function flipArguments(F) { const sig = Reflect.getReflection(F).signatures[0]; return fnType(sig.parameters.map(p => p.type).reverse(), sig.return.type); }`;
  expectBuilderTrue(`${f}
    type F = (a: string, b: uint32, c: boolean) => void;
    type Expected = (arg0: boolean, arg1: uint32, arg2: string) => void;
    String(flipArguments(F) === Expected);
  `);
  // no arguments is unchanged
  expectBuilderTrue(`${f}
    type F = () => boolean;
    type Expected = () => boolean;
    String(flipArguments(F) === Expected);
  `);
});

// 3188 - Tuple to Nested Object - fold a tuple of keys into nested objects.
test('medium 3188 - Tuple to Nested Object', () => {
  const f = `
    function tupleToNestedObject(T, V) {
      const r = Reflect.getReflection(T);
      const keys = r.kind === 'tuple' ? r.elements.map(e => Reflect.getReflection(e.type).value) : [];
      let result = V;
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        result = Reflect.makeType({ kind: 'object', properties: [{ name: keys[i], type: result, optional: false, readonly: false }], indexSignatures: [] });
      }
      return result;
    }`;
  expectBuilderTrue(`${f}\n type T = ['a']; type Expected = { a: string }; String(tupleToNestedObject(T, string) === Expected);`);
  expectBuilderTrue(`${f}\n type T = ['a', 'b', 'c']; type Expected = { a: { b: { c: boolean } } }; String(tupleToNestedObject(T, boolean) === Expected);`);
  // an empty tuple returns the value type itself
  expectBuilderTrue(`${f}\n type T = []; String(tupleToNestedObject(T, boolean) === boolean);`);
});

// 4425 - Greater Than - numeric comparison, bigint-safe for the large case.
test('medium 4425 - Greater Than', () => {
  const f = 'function greaterThan(a, b) { return BigInt(a) > BigInt(b) ? type true : type false; }';
  expectBuilderTrue(`${f}\n String(greaterThan(1, 0) === type true);`);
  expectBuilderTrue(`${f}\n String(greaterThan(20, 20) === type false);`);
  expectBuilderTrue(`${f}\n String(greaterThan(10, 100) === type false);`);
  expectBuilderTrue(`${f}\n String(greaterThan(1234567891011, 1234567891010) === type true);`);
});
