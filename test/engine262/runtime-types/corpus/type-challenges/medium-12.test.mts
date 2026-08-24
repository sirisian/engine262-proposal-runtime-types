import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 12.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Index-signature removal, recursive tuple construction (Pascal, Tower of Hanoi),
 * large tuple construction, literal-kind predicates, and object property
 * extraction. Index signatures reflect and round-trip through
 * getReflection/makeType, so removing them is dropping the indexSignatures
 * list. Tuple operands are aliases.
 */


// 1367 - Remove Index Signature - keep the named members, drop the index
// signature. The string-keyed case is expressible: index signatures reflect and
// dropping the indexSignatures list leaves the named properties.
// The corpus's second case keeps a symbol-keyed member; symbol property keys are
// not yet representable in object records, so that case is out of scope here.
test('medium 1367 - Remove Index Signature (string-keyed)', () => {
  expectBuilderTrue(kit(`
    function removeIndexSignature(T) {
      return Reflect.makeType({ kind: 'object', properties: Reflect.getReflection(T).properties, indexSignatures: [] });
    }
    type Foo = { [key: string]: any, foo(): void };
    type Expected = { foo(): void };
    String(removeIndexSignature(Foo) === Expected);
  `));
});

// 30970 - IsFixedStringLiteralType - exactly one string literal type.
test('medium 30970 - IsFixedStringLiteralType', () => {
  const f = `
    function isFixedStringLiteralType(T) {
      const n = Reflect.getReflection(T);
      return n.kind === 'literal' && typeof n.value === 'string' ? type true : type false;
    }`;
  expectBuilderTrue(kit(`${f}\n String(isFixedStringLiteralType(type 'ABC') === type true);`));
  expectBuilderTrue(kit(`${f}\n String(isFixedStringLiteralType(string) === type false);`));
  expectBuilderTrue(kit(`${f}\n type U = 'ABC' | 'DEF'; String(isFixedStringLiteralType(U) === type false);`));
});

// 27958 - CheckRepeatedTuple - some element type occurs more than once (identity).
test('medium 27958 - CheckRepeatedTuple', () => {
  const f = `    function checkRepeatedTuple(T) {
      const r = Reflect.getReflection(T);
      const els = r.kind === 'tuple' ? r.elements.map(e => e.type) : [];
      return els.some((e, i) => els.indexOf(e) !== i) ? type true : type false;
    }`;
  expectBuilderTrue(kit(`${f}\n type T = [float64, float64, string, boolean]; String(checkRepeatedTuple(T) === type true);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3]; String(checkRepeatedTuple(T) === type false);`));
  // a dynamic array has no repeated tuple elements (it is not a tuple)
  expectBuilderTrue(kit(`${f}\n type A = [].<string>; String(checkRepeatedTuple(A) === type false);`));
});

// 7544 - Construct Tuple - a tuple of n `any` elements, with no length limit.
test('medium 7544 - Construct Tuple', () => {
  const f = ` function constructTuple(n) { return tupleOf(Array.from({ length: n }, () => any)); }`;
  expectBuilderTrue(kit(`${f}\n type Expected = [any, any]; String(constructTuple(2) === Expected);`));
  expectBuilderTrue(kit(`${f}\n String(Reflect.getReflection(constructTuple(999)).elements.length === 999);`));
  expectBuilderTrue(kit(`${f}\n String(Reflect.getReflection(constructTuple(1000)).elements.length === 1000);`));
});

// 30958 - Pascal's triangle - n rows, each a tuple of the binomial coefficients.
test('medium 30958 - Pascals triangle', () => {
  const f = `    function pascal(n) {
      const rows = [];
      for (let i = 0; i < n; i += 1) {
        const prev = rows[i - 1] || [];
        rows.push(Array.from({ length: i + 1 }, (_, j) => (j === 0 || j === i) ? 1 : prev[j - 1] + prev[j]));
      }
      return tupleOf(rows.map(r => tupleOf(r.map(x => literal(x)))));
    }`;
  expectBuilderTrue(kit(`${f}\n type Expected = [[1]]; String(pascal(1) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = [[1], [1, 1], [1, 2, 1]]; String(pascal(3) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1]]; String(pascal(5) === Expected);`));
});

// 30430 - Tower of Hanoi - the move sequence as a tuple of [from, to] pairs.
test('medium 30430 - Tower of Hanoi', () => {
  const f = `    function hanoi(rings, from = 'A', to = 'B', via = 'C') {
      const moves = (n, f2, t2, v2) => n === 0 ? [] : [...moves(n - 1, f2, v2, t2), tupleOf([literal(f2), literal(t2)]), ...moves(n - 1, v2, t2, f2)];
      return tupleOf(moves(rings, from, to, via));
    }`;
  expectBuilderTrue(kit(`${f}\n type Expected = [['A', 'B']]; String(hanoi(1) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = [['A', 'C'], ['A', 'B'], ['C', 'B']]; String(hanoi(2) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = [['A', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'B'], ['C', 'A'], ['C', 'B'], ['A', 'B']]; String(hanoi(3) === Expected);`));
});

// 29650 - ExtractToObject - flatten a nested key's object into the parent.
test('medium 29650 - ExtractToObject', () => {
  const f = `
    function extractToObject(O, K) {
      const key = Reflect.getReflection(K).value;
      const props = Reflect.getReflection(O).properties;
      const nested = props.find(p => p.name === key);
      const rest = props.filter(p => p.name !== key);
      const nestedProps = Reflect.getReflection(nested.type).properties;
      return Reflect.makeType({ kind: 'object', properties: [...rest, ...nestedProps], indexSignatures: [] });
    }`;
  expectBuilderTrue(kit(`${f}
    type O = { id: '1', myProp: { foo: '2' } };
    type Expected = { id: '1', foo: '2' };
    String(extractToObject(O, type 'myProp') === Expected);
  `));
});
