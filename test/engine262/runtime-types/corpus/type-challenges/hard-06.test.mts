import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the hard tier, shard 6.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Binary arithmetic over bit tuples, deep path picking and key-path enumeration,
 * tree path collection, class-key reflection, unboxing, deep-object identity, and
 * a full Sudoku validity check. All over getReflection/makeType and ordinary JS;
 * Sudoku in particular is the whole grid check as plain loops. Tuple operands are
 * aliases.
 */


// 32532 - Binary Addition - add two bit tuples, returning the sum's bit tuple.
test('hard 32532 - Binary Addition', () => {
  const f = `    function binaryAdd(A, B) {
      const a = elementTypes(A).map(t => Reflect.getReflection(t).value);
      const b = elementTypes(B).map(t => Reflect.getReflection(t).value);
      const sum = (parseInt(a.join(''), 2) + parseInt(b.join(''), 2)).toString(2);
      return tupleOf([...sum].map(c => literal(Number(c))));
    }`;
  expectBuilderTrue(kit(`${f}\n type A = [1]; type B = [1]; type Expected = [1, 0]; String(binaryAdd(A, B) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type A = [0]; type B = [1]; type Expected = [1]; String(binaryAdd(A, B) === Expected);`));
});

// 956 - DeepPick - the nested object along a dotted path.
test('hard 956 - DeepPick', () => {
  const f = `    function deepPick(T, path) {
      const dot = path.indexOf('.');
      const head = dot === -1 ? path : path.slice(0, dot);
      const p = Reflect.getReflection(T).properties.find(x => x.name === head);
      if (!p) { return never; }
      const valueType = dot === -1 ? p.type : deepPick(p.type, path.slice(dot + 1));
      return objectOf([{ name: head, type: valueType, optional: false, readonly: false }]);
    }`;
  expectBuilderTrue(kit(`${f}\n type T = { a: { b: { c: uint32 }, x: string } }; type Expected = { a: { b: { c: uint32 } } }; String(deepPick(T, 'a.b.c') === Expected);`));
});

// 7258 - Object Key Paths - every dotted key path as a union of literals.
test('hard 7258 - Object Key Paths', () => {
  const f = `    function collect(T, prefix, out) {
      const node = Reflect.getReflection(T);
      const entries = node.kind === 'tuple'
        ? node.elements.map((e, i) => [String(i), e.type])
        : (node.kind === 'object' ? node.properties.filter(p => typeof p.name === 'string').map(p => [p.name, p.type]) : []);
      for (const [name, t] of entries) {
        const full = prefix ? prefix + '.' + name : name;
        out.push(full);
        collect(t, full, out);
      }
    }
    function objectKeyPaths(T) { const out = []; collect(T, '', out); return union([...new Set(out)].map(p => literal(p))); }`;
  expectBuilderTrue(kit(`${f}\n type T = { a: string, b: { c: uint32 } }; type Expected = 'a' | 'b' | 'b.c'; String(objectKeyPaths(T) === Expected);`));
});

// 15260 - Tree path array - every root-to-node key path as a union of tuples.
test('hard 15260 - Tree path array', () => {
  const f = `    function paths(T) {
      const result = [];
      function walk(t, prefix) {
        const n = Reflect.getReflection(t);
        if (n.kind !== 'object') { return; }
        for (const p of n.properties) { const path = [...prefix, p.name]; result.push(path); walk(p.type, path); }
      }
      walk(T, []);
      return union(result.map(path => tupleOf(path.map(k => literal(k)))));
    }`;
  expectBuilderTrue(kit(`${f}
    type T = { a: { b: {}, c: {} }, d: {} };
    type Expected = ['a'] | ['a', 'b'] | ['a', 'c'] | ['d'];
    String(paths(T) === Expected);
  `));
});

// 2828 - ClassPublicKeys - the property names of a class type.
test('hard 2828 - ClassPublicKeys', () => {
  const f = `    function union(a) { return Reflect.makeType({ kind: 'union', members: a }); }
    function classPublicKeys(T) { return union(Reflect.getReflection(T).properties.map(p => literal(p.name))); }`;
  expectBuilderTrue(kit(`${f}\n type A = { str: string, getNum: () => uint32 }; type Expected = 'str' | 'getNum'; String(classPublicKeys(A) === Expected);`));
});

// 32427 - Unbox - the function return, array element, or union of tuple elements.
test('hard 32427 - Unbox', () => {
  const f = `    function unbox(T) {
      const node = Reflect.getReflection(T);
      if (node.kind === 'function') { return node.signatures[0].return.type; }
      if (node.kind === 'array') { return node.element; }
      if (node.kind === 'tuple') { return union(node.elements.map(e => e.type)); }
      return T;
    }`;
  expectBuilderTrue(kit(`${f}\n type F = () => uint32; String(unbox(F) === uint32);`));
  expectBuilderTrue(kit(`${f}\n type A = [].<string>; String(unbox(A) === string);`));
  expectBuilderTrue(kit(`${f}\n type Tp = [1, 2, 3]; type Expected = 1 | 2 | 3; String(unbox(Tp) === Expected);`));
});

// 553 - Deep object to unique - a deterministic deep rebuild, so interned
// identity still holds across two calls on the same input.
test('hard 553 - Deep object to unique', () => {
  const f = `    function deepObjectToUniq(T) {
      const n = Reflect.getReflection(T);
      if (n.kind !== 'object') { return T; }
      return objectOf(n.properties.map(p => ({ ...p, type: deepObjectToUniq(p.type) })));
    }`;
  expectBuilderTrue(kit(`${f}\n type O = { a: { b: uint32 }, c: string }; String(deepObjectToUniq(O) === deepObjectToUniq(O));`));
});

// 31797 - Sudoku - a solved 9x9 grid has every row, column, and box complete.
test('hard 31797 - Sudoku', () => {
  const f = `    function complete(cells) { return new Set(cells).size === 9; }
    function sudokuSolved(T) {
      const grid = elementTypes(T).map(row => elementTypes(row).map(c => Reflect.getReflection(c).value));
      for (const row of grid) { if (!complete(row)) { return type false; } }
      for (let c = 0; c < 9; c += 1) { if (!complete(grid.map(r => r[c]))) { return type false; } }
      for (let br = 0; br < 9; br += 3) {
        for (let bc = 0; bc < 9; bc += 3) {
          const box = [];
          for (let r = 0; r < 3; r += 1) { for (let c = 0; c < 3; c += 1) { box.push(grid[br + r][bc + c]); } }
          if (!complete(box)) { return type false; }
        }
      }
      return type true;
    }`;
  expectBuilderTrue(kit(`${f}
    type Solved = [
      [5,3,4,6,7,8,9,1,2],[6,7,2,1,9,5,3,4,8],[1,9,8,3,4,2,5,6,7],
      [8,5,9,7,6,1,4,2,3],[4,2,6,8,5,3,7,9,1],[7,1,3,9,2,4,8,5,6],
      [9,6,1,5,3,7,2,8,4],[2,8,7,4,1,9,6,3,5],[3,4,5,2,8,6,1,7,9]
    ];
    String(sudokuSolved(Solved) === type true);
  `));
  expectBuilderTrue(kit(`${f}
    type Bad = [
      [5,3,4,6,7,8,9,1,2],[6,7,2,1,9,5,3,4,8],[1,9,8,3,4,2,5,6,7],
      [8,5,9,7,6,1,4,2,3],[4,2,6,8,5,3,7,9,1],[7,1,3,9,2,4,8,5,6],
      [9,6,1,5,3,7,2,8,4],[2,8,7,4,1,9,6,3,5],[3,4,5,2,8,6,1,7,8]
    ];
    String(sudokuSolved(Bad) === type false);
  `));
});
