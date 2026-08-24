import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 8.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * DeepMutable (the readonly-stripping counterpart to Deep Readonly), tuple
 * pairing and matrix transpose, and the arithmetic/predicate challenges. The
 * arithmetic ones are ordinary JS number math in the builder, which is the whole
 * point the corpus keeps making: the erased language's type-level arithmetic and
 * recursion-limit workarounds have no counterpart here. Tuple operands are
 * aliases (the `type [...]` limitation).
 */


// 17973 - DeepMutable - strip readonly recursively.
test('medium 17973 - DeepMutable', () => {
  expectBuilderTrue(kit(`
    function deepMutable(T) {
      const n = Reflect.getReflection(T);
      if (n.kind !== 'object') return T;
      return Reflect.makeType({ kind: 'object', properties: n.properties.map(p => ({ ...p, readonly: false, type: deepMutable(p.type) })), indexSignatures: [] });
    }
    type X = { readonly a: () => 22, readonly b: string, readonly c: { readonly d: boolean } };
    type Expected = { a: () => 22, b: string, c: { d: boolean } };
    String(deepMutable(X) === Expected);
  `));
});

// 4471 - Zip - pair up two tuples element-wise, to the shorter length.
test('medium 4471 - Zip', () => {
  const f = `    function zip(A, B) {
      const a = elementTypes(A), b = elementTypes(B);
      const n = Math.min(Number(a.length), Number(b.length));
      const out = [];
      for (let i = 0; i < n; i += 1) { out.push(tupleOf([a[i], b[i]])); }
      return tupleOf(out);
    }`;
  expectBuilderTrue(kit(`${f}\n type A = [1, 2]; type B = [true, false]; type Expected = [[1, true], [2, false]]; String(zip(A, B) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type A = [1, 2, 3]; type B = ['1', '2']; type Expected = [[1, '1'], [2, '2']]; String(zip(A, B) === Expected);`));
});

// 25270 - Transpose - swap rows and columns of a tuple of tuples.
test('medium 25270 - Transpose', () => {
  const f = `    function transpose(M) {
      const rows = elementTypes(M).map(r => elementTypes(r));
      if (Number(rows.length) === 0) { return tupleOf([]); }
      const out = [];
      for (let c = 0; c < rows[0].length; c += 1) { out.push(tupleOf(rows.map(r => r[c]))); }
      return tupleOf(out);
    }`;
  expectBuilderTrue(kit(`${f}\n type M = [[1, 2], [3, 4]]; type Expected = [[1, 3], [2, 4]]; String(transpose(M) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type M = [[1, 2, 3], [4, 5, 6]]; type Expected = [[1, 4], [2, 5], [3, 6]]; String(transpose(M) === Expected);`));
});

// 9896 - GetMiddleElement - the middle one (odd length) or two (even length).
test('medium 9896 - GetMiddleElement', () => {
  const f = `    function getMiddleElement(T) {
      const e = elementTypes(T);
      const n = Number(e.length);
      if (n === 0) { return tupleOf([]); }
      return n % 2 ? tupleOf([e[(n - 1) / 2]]) : tupleOf([e[n / 2 - 1], e[n / 2]]);
    }`;
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3, 4, 5]; type Expected = [3]; String(getMiddleElement(T) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3, 4, 5, 6]; type Expected = [3, 4]; String(getMiddleElement(T) === Expected);`));
});

// 27133 - Square - n squared, as a literal number type. Ordinary JS math.
test('medium 27133 - Square', () => {
  const f = ` function square(n) { return literal(n * n); }`;
  expectBuilderTrue(kit(`${f}\n String(square(3) === type 9);`));
  expectBuilderTrue(kit(`${f}\n String(square(101) === type 10201);`));
  expectBuilderTrue(kit(`${f}\n String(square(-31) === type 961);`));
});

// 27152 - Triangular number - n(n+1)/2.
test('medium 27152 - Triangular number', () => {
  const f = ` function triangular(n) { return literal(n * (n + 1) / 2); }`;
  expectBuilderTrue(kit(`${f}\n String(triangular(3) === type 6);`));
  expectBuilderTrue(kit(`${f}\n String(triangular(10) === type 55);`));
});

// 30301 - IsOdd - a literal integer type that is odd.
test('medium 30301 - IsOdd', () => {
  const f = `
    function isOdd(T) {
      const n = Reflect.getReflection(T);
      return n.kind === 'literal' && Number.isInteger(n.value) && n.value % 2 !== 0 ? type true : type false;
    }`;
  expectBuilderTrue(kit(`${f}\n String(isOdd(type 5) === type true);`));
  expectBuilderTrue(kit(`${f}\n String(isOdd(type 2023) === type true);`));
  expectBuilderTrue(kit(`${f}\n String(isOdd(type 1926) === type false);`));
});

// 18142 - All - every element type is identical to N.
test('medium 18142 - All', () => {
  const f = ` function all(T, N) { return elementTypes(T).every(t => t === N) ? type true : type false; }`;
  expectBuilderTrue(kit(`${f}\n type T = [1, 1, 1]; String(all(T, type 1) === type true);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 1, 2]; String(all(T, type 1) === type false);`));
  // identity: '1' elements do not equal the number 1
  expectBuilderTrue(kit(`${f}\n type T = ['1', '1', '1']; String(all(T, type 1) === type false);`));
});

// 19749 - IsEqual - pointer identity, so any and 1 differ, and distinct types
// are simply distinct objects.
test('medium 19749 - IsEqual', () => {
  const f = 'function isEqual(A, B) { return A === B ? type true : type false; }';
  expectBuilderTrue(kit(`${f}\n String(isEqual(type 1, type 1) === type true);`));
  expectBuilderTrue(kit(`${f}\n String(isEqual(float64, string) === type false);`));
  expectBuilderTrue(kit(`${f}\n String(isEqual(any, type 1) === type false);`));
});

// 35991 - MyUppercase - uppercase a string, as a literal type.
test('medium 35991 - MyUppercase', () => {
  const f = ` function myUppercase(s) { return literal(s.toUpperCase()); }`;
  expectBuilderTrue(kit(`${f}\n String(myUppercase('a') === type 'A');`));
  expectBuilderTrue(kit(`${f}\n String(myUppercase('Z') === type 'Z');`));
});
