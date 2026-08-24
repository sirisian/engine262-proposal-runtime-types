import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the extreme tier, shard 1.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * The extreme tier is where an erased type system fights the recursion limit
 * hardest: arbitrary-precision arithmetic, sorting, slicing. In the builder these
 * are one-liners: BigInt for the arithmetic, Array.prototype.sort for the sort,
 * Array.prototype.slice for the slice. Interned identity does the rest. Tuple
 * operands are aliases; a `type []` result is a constructed empty tuple.
 */


// 5 - Get Readonly Keys - the names of the readonly properties.
test('extreme 5 - Get Readonly Keys', () => {
  const f = `    function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
    function getReadonlyKeys(T) { return union(Reflect.getReflection(T).properties.filter(p => p.readonly).map(p => literal(p.name))); }`;
  expectBuilderTrue(kit(`${f}\n type Todo = { readonly title: string, description: string }; String(getReadonlyKeys(Todo) === type 'title');`));
  expectBuilderTrue(kit(`${f}\n type T = { readonly a: uint32, readonly b: string, c: boolean }; type Expected = 'a' | 'b'; String(getReadonlyKeys(T) === Expected);`));
});

// 216 - Slice - the tuple slice, with Array.prototype.slice's negative indices.
test('extreme 216 - Slice', () => {
  const f = ` function slice(T, start, end) { return tupleOf(elementTypes(T).slice(start, end)); }`;
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3, 4, 5]; type Expected = [3, 4]; String(slice(T, 2, 4) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3, 4, 5]; type Expected = [1, 2, 3, 4]; String(slice(T, 0, -1) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3, 4, 5]; type Expected = [3, 4]; String(slice(T, -3, -1) === Expected);`));
});

// 476 - Sum - arbitrary-precision addition of number/string operands.
test('extreme 476 - Sum', () => {
  const f = ` function sum(a, b) { return literal((BigInt(a) + BigInt(b)).toString()); }`;
  expectBuilderTrue(kit(`${f}\n String(sum(2, 3) === type '5');`));
  expectBuilderTrue(kit(`${f}\n String(sum('13', '21') === type '34');`));
  expectBuilderTrue(kit(`${f}\n String(sum(9999, 1) === type '10000');`));
});

// 517 - Multiply - arbitrary-precision multiplication.
test('extreme 517 - Multiply', () => {
  const f = ` function multiply(a, b) { return literal((BigInt(a) * BigInt(b)).toString()); }`;
  expectBuilderTrue(kit(`${f}\n String(multiply(2, 3) === type '6');`));
  expectBuilderTrue(kit(`${f}\n String(multiply(0, 16) === type '0');`));
  expectBuilderTrue(kit(`${f}\n String(multiply('13', '21') === type '273');`));
});

// 7561 - Subtract - non-negative difference, else never.
test('extreme 7561 - Subtract', () => {
  const f = ` function subtract(a, b) { return a - b < 0 ? never : literal(a - b); }`;
  expectBuilderTrue(kit(`${f}\n String(subtract(1, 1) === type 0);`));
  expectBuilderTrue(kit(`${f}\n String(subtract(2, 1) === type 1);`));
  expectBuilderTrue(kit(`${f}\n String(subtract(1, 2) === never);`));
});

// 741 - Sort - ascending, or descending with the flag.
test('extreme 741 - Sort', () => {
  const f = `    function sort(T, desc) {
      const vals = elementTypes(T).map(t => Reflect.getReflection(t).value);
      vals.sort((a, b) => desc ? b - a : a - b);
      return tupleOf(vals.map(v => literal(v)));
    }`;
  expectBuilderTrue(kit(`${f}\n type T = [3, 2, 1]; type Expected = [1, 2, 3]; String(sort(T) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [2, 4, 7, 6, 6, 6, 5, 8, 9]; type Expected = [9, 8, 7, 6, 6, 6, 5, 4, 2]; String(sort(T, true) === Expected);`));
  // an empty tuple sorts to a constructed empty tuple
  expectBuilderTrue(kit(`${f}\n const empty = Reflect.makeType({ kind: 'tuple', elements: [] }); String(sort(empty) === empty);`));
});
