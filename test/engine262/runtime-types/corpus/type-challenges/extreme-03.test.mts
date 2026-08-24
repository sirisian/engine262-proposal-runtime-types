import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the extreme tier, shard 3 (the last five).
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * A full Sudoku validity check, a variadic curry type, union distribution over a
 * tuple, a JSON-to-type parser, and dynamic route parameters. Every one is an
 * ordinary algorithm over interned types: JSON.parse then a recursive build, a
 * recursive curry over the argument tuple, a cartesian product for distribution.
 * Tuple operands are aliases; Currying 2 is asserted as the type transform.
 */

const TUP = `
`;

// 35314 - Valid Sudoku - every row, column, and box of a 9x9 grid is complete.
test('extreme 35314 - Valid Sudoku', () => {
  const f = `${TUP}
    function validSudoku(M) {
      const grid = elementTypes(M).map(row => elementTypes(row).map(c => Reflect.getReflection(c).value));
      const complete = (cells) => new Set(cells).size === 9;
      const i9 = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      return i9.every(i => complete(grid[i]))
        && i9.every(j => complete(i9.map(i => grid[i][j])))
        && i9.every(b => complete(i9.map(k => grid[Math.floor(b / 3) * 3 + Math.floor(k / 3)][(b % 3) * 3 + k % 3])))
        ? type true : type false;
    }
    type Grid = [
      [1, 2, 3, 4, 5, 6, 7, 8, 9], [4, 5, 6, 7, 8, 9, 1, 2, 3], [7, 8, 9, 1, 2, 3, 4, 5, 6],
      [2, 3, 1, 5, 6, 4, 8, 9, 7], [5, 6, 4, 8, 9, 7, 2, 3, 1], [8, 9, 7, 2, 3, 1, 5, 6, 4],
      [3, 1, 2, 6, 4, 5, 9, 7, 8], [6, 4, 5, 9, 7, 8, 3, 1, 2], [9, 7, 8, 3, 1, 2, 6, 4, 5]
    ];`;
  expectBuilderTrue(kit(`${f}\n String(validSudoku(Grid) === type true);`));
  // a duplicated row makes columns incomplete
  expectBuilderTrue(kit(`${f}
    const gridRows = elementTypes(Grid);
    const bad = tupleOf([gridRows[0], gridRows[0], ...gridRows.slice(2)]);
    String(validSudoku(bad) === type false);
  `));
});

// 462 - Currying 2 - an argument tuple and return type to a curried function
// type (one argument per arrow). Asserted as the type transform.
test('extreme 462 - Currying 2', () => {
  const f = `${TUP}
    function curry(Args, R) {
      const elements = Reflect.getReflection(Args).elements;
      if (elements.length === 0) { return fn([], R); }
      const [head, ...tail] = elements;
      return fn([head.type], tail.length === 0 ? R : curry(tupleOf(tail.map(e => e.type)), R));
    }`;
  expectBuilderTrue(kit(`${f}
    type Args = [string, uint32, boolean];
    type Expected = (a: string) => (b: uint32) => (c: boolean) => true;
    String(curry(Args, type true) === Expected);
  `));
  expectBuilderTrue(kit(`${f}\n type Args = [string]; type Expected = (a: string) => uint32; String(curry(Args, uint32) === Expected);`));
});

// 869 - DistributeUnions - a tuple of unions to the union of tuple combinations.
test('extreme 869 - DistributeUnions', () => {
  const f = `${TUP}
    function distribute(columns) {
      if (columns.length === 0) { return [[]]; }
      const [first, ...rest] = columns;
      const restProduct = distribute(rest);
      const out = [];
      for (const a of arms(first)) { for (const combo of restProduct) { out.push([a, ...combo]); } }
      return out;
    }
    function distributeUnions(T) {
      const node = Reflect.getReflection(T);
      if (node.kind !== 'tuple') { return T; }
      return union(distribute(node.elements.map(e => e.type)).map(combo => tupleOf(combo)));
    }`;
  expectBuilderTrue(kit(`${f}
    type T = [1 | 2, 'a' | 'b'];
    type Expected = [1, 'a'] | [1, 'b'] | [2, 'a'] | [2, 'b'];
    String(distributeUnions(T) === Expected);
  `));
});

// 6228 - JSON Parser - a JSON string to the type of its value.
test('extreme 6228 - JSON Parser', () => {
  const f = `${TUP}
    function build(v) {
      if (v === null) { return type null; }
      if (Array.isArray(v)) { return tupleOf(v.map(build)); }
      if (typeof v === 'object') { return objectOf(Object.entries(v).map(([k, x]) => ({ name: k, type: build(x), optional: false, readonly: false }))); }
      return literal(v);
    }
    function parseJSON(s) { return build(JSON.parse(s)); }`;
  expectBuilderTrue(kit(`${f}
    type Expected = { a: 'b', b: false, c: [true, false, 'hello'], nil: null };
    String(parseJSON('{"a":"b","b":false,"c":[true,false,"hello"],"nil":null}') === Expected);
  `));
});

// 33345 - Dynamic Route - the `:name` segments as an object of string params.
test('extreme 33345 - Dynamic Route', () => {
  const f = `${TUP}
    function dynamicRoute(route) {
      const parts = route.split('/').filter(p => p.startsWith(':')).map(p => p.slice(1));
      return objectOf(parts.map(p => ({ name: p, type: string, optional: false, readonly: false })));
    }`;
  expectBuilderTrue(kit(`${f}\n const empty = Reflect.makeType({ kind: 'object', properties: [], indexSignatures: [] }); String(dynamicRoute('/shop') === empty);`));
  expectBuilderTrue(kit(`${f}\n type Expected = { id: string }; String(dynamicRoute('/shop/product/:id') === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = { categoryId: string, productId: string }; String(dynamicRoute('/shop/:categoryId/:productId') === Expected);`));
});
