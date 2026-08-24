import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the hard tier, shard 3.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Union-arm filtering (with the `never` = empty-union trick), readonly-key
 * reflection, tuple set intersection, and numeric/string algorithms. Uses the
 * `undefined` type from shard 1. Tuple operands are aliases.
 */


// 399 - Tuple Filter - drop each element whose every arm is in the filter set.
// `never` has no arms, so `.every(...)` is vacuously true and it is dropped; a
// union survives unless all of its arms are in the set (the third case pins
// this: number|null|undefined is kept though two of its three arms match).
test('hard 399 - Tuple Filter', () => {
  const f = ` function filterOut(T, F) { const drop = new Set(arms(F)); return tupleOf(elementTypes(T).filter(t => !arms(t).every(arm => drop.has(arm)))); }`;
  expectBuilderTrue(kit(`${f}\n type T = [1, never, 'a']; type Expected = [1, 'a']; String(filterOut(T, never) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [never, 1, 'a', undefined, false, null]; type F = never | null | undefined; type Expected = [1, 'a', false]; String(filterOut(T, F) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [float64 | null | undefined, never]; type F = never | null | undefined; type Expected = [float64 | null | undefined]; String(filterOut(T, F) === Expected);`));
});

// 2059 - Drop String - remove every occurrence of the given characters.
test('hard 2059 - Drop String', () => {
  const f = ` function dropString(s, chars) { const set = new Set([...chars]); return literal([...s].filter(c => !set.has(c)).join('')); }`;
  expectBuilderTrue(kit(`${f}\n String(dropString('butter fly!', '') === type 'butter fly!');`));
  expectBuilderTrue(kit(`${f}\n String(dropString('butter fly!', ' ') === type 'butterfly!');`));
  expectBuilderTrue(kit(`${f}\n String(dropString('butter fly!', 'but') === type 'er fly!');`));
});

// 5181 - Mutable Keys - the names of the non-readonly properties.
test('hard 5181 - Mutable Keys', () => {
  const f = ` function mutableKeys(T) { return union(Reflect.getReflection(T).properties.filter(p => !p.readonly).map(p => literal(p.name))); }`;
  expectBuilderTrue(kit(`${f}\n type X = { a: uint32, readonly b: string }; String(mutableKeys(X) === type 'a');`));
  expectBuilderTrue(kit(`${f}\n type X = { a: undefined, readonly b?: undefined, c: string, d: null }; type Expected = 'a' | 'c' | 'd'; String(mutableKeys(X) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type X = {}; String(mutableKeys(X) === never);`));
});

// 5423 - Intersection - the values common to every tuple/union element.
test('hard 5423 - Intersection', () => {
  const f = `    function intersection(T) {
      const sets = Reflect.getReflection(T).elements.map(e => {
        const node = Reflect.getReflection(e.type);
        return new Set(node.kind === 'tuple' ? node.elements.map(x => x.type) : arms(e.type));
      });
      if (sets.length === 0) { return never; }
      const common = [...sets[0]].filter(x => sets.every(s => s.has(x)));
      return common.length === 0 ? never : union(common);
    }`;
  expectBuilderTrue(kit(`${f}\n type T = [[1, 2], [2, 3], [2, 2]]; type Expected = 2; String(intersection(T) === Expected);`));
});

// 8804 - Two Sum - some pair of element values sums to the target.
test('hard 8804 - Two Sum', () => {
  const f = `
    function twoSum(T, target) {
      const values = Reflect.getReflection(T).elements.map(e => Reflect.getReflection(e.type).value);
      return values.some((a, i) => values.slice(i + 1).some(b => a + b === target)) ? type true : type false;
    }`;
  expectBuilderTrue(kit(`${f}\n type T = [3, 3]; String(twoSum(T, 6) === type true);`));
  expectBuilderTrue(kit(`${f}\n type T = [3, 2, 4]; String(twoSum(T, 6) === type true);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3]; String(twoSum(T, 7) === type false);`));
});

// 9384 - Maximum - the greatest element value, or never for an empty tuple.
test('hard 9384 - Maximum', () => {
  const f = `    function maximum(T) {
      const values = Reflect.getReflection(T).elements.map(e => Reflect.getReflection(e.type).value);
      return Number(values.length) === 0 ? never : literal(Math.max(...values));
    }`;
  expectBuilderTrue(kit(`${f}\n type T = [0, 2, 1]; String(maximum(T) === type 2);`));
  // empty tuple is constructed (an expected `type []` would be an array)
  expectBuilderTrue(kit(`${f}\n const empty = Reflect.makeType({ kind: 'tuple', elements: [] }); String(maximum(empty) === never);`));
});

// 19458 - SnakeCase - lowercase, underscore before each former capital.
test('hard 19458 - SnakeCase', () => {
  const f = ` function snakeCase(T) { const s = Reflect.getReflection(T).value; return literal(s.replace(/[A-Z]/g, c => '_' + c.toLowerCase())); }`;
  expectBuilderTrue(kit(`${f}\n String(snakeCase(type 'hello') === type 'hello');`));
  expectBuilderTrue(kit(`${f}\n String(snakeCase(type 'userName') === type 'user_name');`));
  expectBuilderTrue(kit(`${f}\n String(snakeCase(type 'getElementById') === type 'get_element_by_id');`));
});

// 30575 - BitwiseXOR - XOR two equal-length bit strings.
test('hard 30575 - BitwiseXOR', () => {
  const f = ` function bitwiseXOR(x, y) { return literal([...x].map((c, i) => c === y[i] ? '0' : '1').join('')); }`;
  expectBuilderTrue(kit(`${f}\n String(bitwiseXOR('0', '1') === type '1');`));
  expectBuilderTrue(kit(`${f}\n String(bitwiseXOR('1', '1') === type '0');`));
});
