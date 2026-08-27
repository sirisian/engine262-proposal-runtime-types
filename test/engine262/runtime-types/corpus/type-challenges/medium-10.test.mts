import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

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


// 296 - Permutation - a union to the union of its element permutations (tuples).
test('medium 296 - Permutation', () => {
  const f = `    function permute(items) {
      if (Number(items.length) <= 1) { return [items]; }
      const out = [];
      for (let i = 0; i < Number(items.length); i += 1) {
        const rest = [...items.slice(0, i), ...items.slice(i + 1)];
        for (const p of permute(rest)) { out.push([items[i], ...p]); }
      }
      return out;
    }
    function permutation(U) { return union(permute(arms(U)).map(p => tupleOf(p))); }`;
  expectBuilderTrue(kit(`${f}
    type U = 'A' | 'B' | 'C';
    type Expected = ['A','B','C'] | ['A','C','B'] | ['B','A','C'] | ['B','C','A'] | ['C','A','B'] | ['C','B','A'];
    String(permutation(U) === Expected);
  `));
  // a single member permutes to the one-element tuple
  expectBuilderTrue(kit(`${f}
    type U = 'A';
    type Expected = ['A'];
    String(permutation(U) === Expected);
  `));
  // NOTE: the corpus also asserts permutation(boolean) === [false,true] | [true,false],
  // which relies on `boolean` decomposing into `false | true`. In this type system
  // `boolean` is a distinct primitive, NOT the union of its literals (the spec's
  // literal rule makes `true | false` a subtype of `boolean`, deliberately not the
  // reverse), so `arms(boolean)` is `[boolean]` and that assertion does not hold
  // here. The union-of-literals form is what decomposes, so:
  expectBuilderTrue(kit(`${f}
    type U = false | true;
    type Expected = [false, true] | [true, false];
    String(permutation(U) === Expected);
  `));
});

// 21220 - Permutations of Tuple - the same over a tuple's element types.
test('medium 21220 - Permutations of Tuple', () => {
  const f = `    function permute(items) {
      if (Number(items.length) <= 1) { return [items]; }
      const out = [];
      for (let i = 0; i < Number(items.length); i += 1) {
        const rest = [...items.slice(0, i), ...items.slice(i + 1)];
        for (const p of permute(rest)) { out.push([items[i], ...p]); }
      }
      return out;
    }
    function permutationsOfTuple(T) { return union(permute(elementTypes(T)).map(p => tupleOf(p))); }`;
  expectBuilderTrue(kit(`${f}
    type T = [1, 2, 3];
    type Expected = [1,2,3] | [1,3,2] | [2,1,3] | [2,3,1] | [3,1,2] | [3,2,1];
    String(permutationsOfTuple(T) === Expected);
  `));
});

// 27862 - CartesianProduct - pairs from two unions.
test('medium 27862 - CartesianProduct', () => {
  const f = `    function cartesianProduct(A, B) {
      const a = arms(A), b = arms(B);
      const out = [];
      for (const x of a) { for (const y of b) { out.push(tupleOf([x, y])); } }
      return union(out);
    }`;
  expectBuilderTrue(kit(`${f}
    type A = 1 | 2; type B = 'a' | 'b';
    type Expected = [1, 'a'] | [1, 'b'] | [2, 'a'] | [2, 'b'];
    String(cartesianProduct(A, B) === Expected);
  `));
  // never as a union member contributes nothing (arms of never is empty)
  expectBuilderTrue(kit(`${f}
    type A = 1 | 2; type B = 'a' | never;
    type Expected = [1, 'a'] | [2, 'a'];
    String(cartesianProduct(A, B) === Expected);
  `));
});

// 8987 - Subsequence - the power set of a tuple, as a union of tuples. The
// empty subsequence is a constructed empty tuple (an expected `type []` would be
// a dynamic array, a different type).
test('medium 8987 - Subsequence', () => {
  const f = `    function go(els) { return Number(els.length) === 0 ? [[]] : go(els.slice(1)).flatMap(rest => [rest, [els[0], ...rest]]); }
    function subsequence(T) { return union(go(elementTypes(T)).map(s => tupleOf(s))); }`;
  expectBuilderTrue(kit(`${f}
    type T = [1, 2];
    type P1 = [1]; type P2 = [2]; type P3 = [1, 2];
    const expected = union([tupleOf([]), P1, P2, P3]);
    String(subsequence(T) === expected);
  `));
});

// 4260 - AllCombinations - every ordered combination of a string's characters.
test('medium 4260 - AllCombinations', () => {
  const f = `    function allCombinations(s) {
      const result = new Set(['']);
      function perm(prefix, remaining) {
        for (let i = 0; i < Number(remaining.length); i += 1) {
          const next = prefix + remaining[i];
          result.add(next);
          perm(next, [...remaining.slice(0, i), ...remaining.slice(i + 1)]);
        }
      }
      perm('', [...s]);
      return Reflect.makeType({ kind: 'union', members: [...result].map(x => literal(x)) });
    }`;
  expectBuilderTrue(kit(`${f}\n String(allCombinations('') === type '');`));
  expectBuilderTrue(kit(`${f}\n type Expected = '' | 'A'; String(allCombinations('A') === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = '' | 'A' | 'B' | 'AB' | 'BA'; String(allCombinations('AB') === Expected);`));
});

// 3196 - Flip Arguments - reverse a function type's parameter list.
test('medium 3196 - Flip Arguments', () => {
  const f = `
    function fnType(params, ret) { return Reflect.makeType({ kind: 'function', signatures: [{ parameters: params.map(t => ({ type: t })), return: { type: ret } }] }); }
    function flipArguments(F) { const sig = Reflect.getReflection(F).signatures[0]; return fnType(sig.parameters.map(p => p.type).reverse(), sig.return.type); }`;
  expectBuilderTrue(kit(`${f}
    type F = (a: string, b: uint32, c: boolean) => void;
    type Expected = (arg0: boolean, arg1: uint32, arg2: string) => void;
    String(flipArguments(F) === Expected);
  `));
  // no arguments is unchanged
  expectBuilderTrue(kit(`${f}
    type F = () => boolean;
    type Expected = () => boolean;
    String(flipArguments(F) === Expected);
  `));
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
  expectBuilderTrue(kit(`${f}\n type T = ['a']; type Expected = { a: string }; String(tupleToNestedObject(T, string) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = ['a', 'b', 'c']; type Expected = { a: { b: { c: boolean } } }; String(tupleToNestedObject(T, boolean) === Expected);`));
  // an empty tuple returns the value type itself
  expectBuilderTrue(kit(`${f}\n type T = []; String(tupleToNestedObject(T, boolean) === boolean);`));
});

// 4425 - Greater Than - numeric comparison, bigint-safe for the large case.
test('medium 4425 - Greater Than', () => {
  const f = 'function greaterThan(a, b) { return BigInt(a) > BigInt(b) ? type true : type false; }';
  expectBuilderTrue(kit(`${f}\n String(greaterThan(1, 0) === type true);`));
  expectBuilderTrue(kit(`${f}\n String(greaterThan(20, 20) === type false);`));
  expectBuilderTrue(kit(`${f}\n String(greaterThan(10, 100) === type false);`));
  expectBuilderTrue(kit(`${f}\n String(greaterThan(1234567891011, 1234567891010) === type true);`));
});
