import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 7.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Object key/value transforms, nested-tuple construction, union-of-objects
 * transforms, and numeric sequences. The corpus's note that its recursion-limit
 * gymnastics are the erased language's problem, not the builder's, shows here:
 * Fibonacci and Combination are ordinary loops. Tuple operands are aliases.
 */


// 4179 - Flip - swap keys and values (values are literal types).
test('medium 4179 - Flip', () => {
  const f = `    function flip(T) {
      const props = Reflect.getReflection(T).properties.map(p => ({
        name: String(Reflect.getReflection(p.type).value),
        type: literal(p.name),
        optional: false,
        readonly: false,
      }));
      return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] });
    }`;
  expectBuilderTrue(kit(`${f}\n type X = { pi: 'a' }; type Expected = { a: 'pi' }; String(flip(X) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type X = { prop1: 'val1', prop2: 'val2' }; type Expected = { val1: 'prop1', val2: 'prop2' }; String(flip(X) === Expected);`));
});

// 4499 - Chunk - split a tuple into chunks of size n (a tuple of tuples).
test('medium 4499 - Chunk', () => {
  const f = `    function chunk(T, n) {
      const els = elementTypes(T);
      const out = [];
      for (let i = 0; i < Number(els.length); i += n) { out.push(tupleOf(els.slice(i, i + n))); }
      return tupleOf(out);
    }`;
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3]; type Expected = [[1, 2], [3]]; String(chunk(T, 2) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3, 4]; type Expected = [[1, 2], [3, 4]]; String(chunk(T, 2) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3, 4]; type Expected = [[1, 2, 3, 4]]; String(chunk(T, 5) === Expected);`));
});

// 4518 - Fill - replace elements in [start, end) with V.
test('medium 4518 - Fill', () => {
  const f = `    function fill(T, V, start, end) {
      const els = elementTypes(T);
      const s = start ?? 0;
      const e = end ?? Number(els.length);
      return tupleOf(els.map((el, i) => (i >= s && i < e) ? V : el));
    }`;
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3]; type Expected = [0, 0, 0]; String(fill(T, type 0) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3]; type Expected = [true, 2, 3]; String(fill(T, type true, 0, 1) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3]; type Expected = [1, true, true]; String(fill(T, type true, 1, 3) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3]; type Expected = [1, 2, 3]; String(fill(T, type true, 10, 20) === Expected);`));
});

// 1978 - Percentage Parser - split into sign, digits, and percent.
test('medium 1978 - Percentage Parser', () => {
  const f = `    function percentageParser(s) {
      const m = s.match(/^([+-]?)(\\d*)(%?)$/);
      return tupleOf([literal(m[1]), literal(m[2]), literal(m[3])]);
    }`;
  expectBuilderTrue(kit(`${f}\n type Expected = ['+', '100', '%']; String(percentageParser('+100%') === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = ['-', '100', '']; String(percentageParser('-100') === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = ['', '', '%']; String(percentageParser('%') === Expected);`));
});

// 1130 - ReplaceKeys - in a union of objects, rename keys per a replacement map.
test('medium 1130 - ReplaceKeys', () => {
  const f = `
    function replaceKeys(U, repl) {
      const arms = Reflect.getReflection(U).arms.map(a => {
        const props = Reflect.getReflection(a).properties.map(p => {
          const r = repl.find(x => x.name === p.name);
          return r ? { ...p, name: r.to } : p;
        });
        return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] });
      });
      return Reflect.makeType({ kind: 'union', arms });
    }`;
  expectBuilderTrue(kit(`${f}
    type A = { a: uint32, b: string };
    type B = { a: boolean, c: string };
    type U = A | B;
    type Expected = { x: uint32, b: string } | { x: boolean, c: string };
    String(replaceKeys(U, [{ name: 'a', to: 'x' }]) === Expected);
  `));
});

// 4182 - Fibonacci Sequence - the nth Fibonacci number as a literal type.
test('medium 4182 - Fibonacci Sequence', () => {
  const f = `    function fibonacci(n) {
      let a = 1, b = 1;
      for (let i = 3; i <= n; i += 1) { const t = a + b; a = b; b = t; }
      return literal(n <= 2 ? 1 : b);
    }`;
  expectBuilderTrue(kit(`${f}\n String(fibonacci(1) === type 1);`));
  expectBuilderTrue(kit(`${f}\n String(fibonacci(3) === type 2);`));
  expectBuilderTrue(kit(`${f}\n String(fibonacci(8) === type 21);`));
});

// 8767 - Combination - every non-empty combination of the strings, space-joined.
test('medium 8767 - Combination', () => {
  const f = `    function combination(items) {
      const out = [];
      const n = Number(items.length);
      for (let mask = 1; mask < (1 << n); mask += 1) {
        out.push(literal(items.filter((_, i) => mask & (1 << i)).join(' ')));
      }
      return Reflect.makeType({ kind: 'union', arms: out });
    }`;
  expectBuilderTrue(kit(`${f}
    type Expected = 'foo' | 'bar' | 'foo bar' | 'baz' | 'foo baz' | 'bar baz' | 'foo bar baz';
    String(combination(['foo', 'bar', 'baz']) === Expected);
  `));
});
