import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the hard tier, shard 2.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Union to intersection, the any predicate, string casing and reversal, and
 * binary/decimal and FizzBuzz numeric work. All over getReflection/makeType and
 * ordinary JS. Tuple operands are aliases.
 */


// 55 - Union to Intersection - the arms of a union as an intersection.
test('hard 55 - Union to Intersection', () => {
  const f = ` function unionToIntersection(U) { return Reflect.makeType({ kind: 'intersection', members: arms(U) }); }`;
  expectBuilderTrue(kit(`${f}\n type U = 'foo' | 42 | true; type Expected = 'foo' & 42 & true; String(unionToIntersection(U) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type U = (() => 'foo') | ((i: 42) => true); type Expected = (() => 'foo') & ((i: 42) => true); String(unionToIntersection(U) === Expected);`));
});

// 223 - IsAny - identity against the any type.
test('hard 223 - IsAny', () => {
  const f = 'function isAny(T) { return T === any ? type true : type false; }';
  expectBuilderTrue(kit(`${f}\n String(isAny(any) === type true);`));
  expectBuilderTrue(kit(`${f}\n String(isAny(undefined) === type false);`));
  expectBuilderTrue(kit(`${f}\n String(isAny(never) === type false);`));
});

// 112 - Capitalize Words - capitalize the first letter of every word.
test('hard 112 - Capitalize Words', () => {
  const f = `    function capitalizeWords(s) { return literal(s.replace(/(^|[^a-zA-Z])([a-z])/g, (m, p, c) => p + c.toUpperCase())); }`;
  expectBuilderTrue(kit(`${f}\n String(capitalizeWords('foobar') === type 'Foobar');`));
  expectBuilderTrue(kit(`${f}\n String(capitalizeWords('FOOBAR') === type 'FOOBAR');`));
  expectBuilderTrue(kit(`${f}\n String(capitalizeWords('foo bar.hello,world') === type 'Foo Bar.Hello,World');`));
});

// 651 - Length of String 2 - the length as a literal number type.
test('hard 651 - Length of String 2', () => {
  const f = ` function lengthOfString(s) { return literal(s.length); }`;
  expectBuilderTrue(kit(`${f}\n String(lengthOfString('') === type 0);`));
  expectBuilderTrue(kit(`${f}\n String(lengthOfString('1234567') === type 7);`));
});

// 4037 - IsPalindrome - reads the same reversed.
test('hard 4037 - IsPalindrome', () => {
  const f = "function isPalindrome(s) { return s === [...s].reverse().join('') ? type true : type false; }";
  expectBuilderTrue(kit(`${f}\n String(isPalindrome('abc') === type false);`));
  expectBuilderTrue(kit(`${f}\n String(isPalindrome('abcba') === type true);`));
});

// 6141 - Binary to Decimal - parse a binary string to a literal number type.
test('hard 6141 - Binary to Decimal', () => {
  const f = ` function binaryToDecimal(s) { return literal(parseInt(s, 2)); }`;
  expectBuilderTrue(kit(`${f}\n String(binaryToDecimal('0011') === type 3);`));
  expectBuilderTrue(kit(`${f}\n String(binaryToDecimal('11111111') === type 255);`));
  expectBuilderTrue(kit(`${f}\n String(binaryToDecimal('10101010') === type 170);`));
});

// 14080 - FizzBuzz - the FizzBuzz words 1..n as a tuple of string literals.
test('hard 14080 - FizzBuzz', () => {
  const f = `    function fizzBuzz(n) {
      const out = [];
      for (let v = 1; v <= n; v += 1) {
        const word = (v % 3 === 0 ? 'Fizz' : '') + (v % 5 === 0 ? 'Buzz' : '');
        out.push(literal(word === '' ? String(v) : word));
      }
      return tupleOf(out);
    }`;
  expectBuilderTrue(kit(`${f}\n type Expected = ['1']; String(fizzBuzz(1) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = ['1', '2', 'Fizz', '4', 'Buzz', 'Fizz', '7', '8', 'Fizz', 'Buzz', '11', 'Fizz', '13', '14', 'FizzBuzz']; String(fizzBuzz(15) === Expected);`));
});

// 847 - String Join - the corpus writes a curried
// `join<D>(delimiter)<P extends [].<string>>(...parts)` whose return type is
// computed from P, and asserts `Reflect.typeOf(join('-')('a','b','c')) === type
// 'a-b-c'`. The RETURN-TYPE TRANSFORM ports directly: given the argument tuple's
// type P (a tuple of string-literal types) and the delimiter, the result is the
// literal type of the joined values, which is `literal(elementTypes(P).map(litval).join(D))`.
// It is asserted here in both plain and curried form, exactly as the corpus's
// builder computes it (Array.prototype.join in the return position).
//
// What is NOT expressible is only the `Reflect.typeOf(join('-')(...))` assertion
// itself: that turns on generic literal inference under a constraint (a parameter
// constrained to a tuple/union of literal types binds the literal type of the
// argument's value, per the generics clause, spec line 929), applied to a runtime
// generic-function-value call. That is the inference fixpoint (EvaluateCall-time
// type-parameter inference with the literal rule and return-type builder
// evaluation), a whole subsystem rather than a contained addition, and it is not
// built. `Reflect.typeOf` of a plain string value is the widened `string` (the
// runtime fact, per spec), not the literal, so the call form cannot be asserted.
// Recorded pending for that form with the named primitive: generic literal
// inference under a constraint applied to a generic call.
test('hard 847 - String Join (return-type transform)', () => {
  const f = `
    function litval(T) { return Reflect.getReflection(T).value; }
    function joinType(P, delimiter) { return literal(elementTypes(P).map(e => litval(e)).join(delimiter)); }
    function join(delimiter) { return (P) => joinType(P, delimiter); }`;
  // join('-')(['a','b','c']) computes 'a-b-c'
  expectBuilderTrue(kit(`${f}\n type P = ['a', 'b', 'c']; String(join('-')(P) === type 'a-b-c');`));
  // an empty argument tuple joins to the empty string (empty tuple constructed)
  expectBuilderTrue(kit(`${f}\n const P = Reflect.makeType({ kind: 'tuple', elements: [] }); String(join('-')(P) === type '');`));
  // a single element is itself
  expectBuilderTrue(kit(`${f}\n type P = ['a']; String(join('-')(P) === type 'a');`));
  // an empty delimiter concatenates
  expectBuilderTrue(kit(`${f}\n type P = ['a', 'b', 'c']; String(join('')(P) === type 'abc');`));
});
