import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the hard tier, shard 1.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Optional/required property reflection, string transforms, and union/tuple
 * conversion, over getReflection/makeType. The `undefined` type was enabled this
 * shard (it names the type of the `undefined` value, which is `void`), so the
 * challenges whose examples use `undefined`-typed properties port fully.
 * Tuple operands are aliases.
 */


// 57 - Get Required - keep the non-optional properties.
test('hard 57 - Get Required', () => {
  const f = ` function getRequired(T) { return objectOf(Reflect.getReflection(T).properties.filter(p => !p.optional)); }`;
  expectBuilderTrue(kit(`${f}\n type X = { foo: uint32, bar?: string }; type Expected = { foo: uint32 }; String(getRequired(X) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type X = { foo: undefined, bar?: undefined }; type Expected = { foo: undefined }; String(getRequired(X) === Expected);`));
});

// 59 - Get Optional - keep the optional properties.
test('hard 59 - Get Optional', () => {
  const f = ` function getOptional(T) { return objectOf(Reflect.getReflection(T).properties.filter(p => p.optional)); }`;
  expectBuilderTrue(kit(`${f}\n type X = { foo: uint32, bar?: string }; type Expected = { bar?: string }; String(getOptional(X) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type X = { foo: undefined, bar?: undefined }; type Expected = { bar?: undefined }; String(getOptional(X) === Expected);`));
});

// 89 - Required Keys - the names of the non-optional properties.
test('hard 89 - Required Keys', () => {
  const f = ` function requiredKeys(T) { return union(Reflect.getReflection(T).properties.filter(p => !p.optional).map(p => literal(p.name))); }`;
  expectBuilderTrue(kit(`${f}\n type X = { a: uint32, b?: string }; String(requiredKeys(X) === type 'a');`));
  expectBuilderTrue(kit(`${f}\n type X = { a: undefined, b?: undefined, c: string, d: null }; type Expected = 'a' | 'c' | 'd'; String(requiredKeys(X) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type X = {}; String(requiredKeys(X) === never);`));
});

// 90 - Optional Keys - the names of the optional properties.
test('hard 90 - Optional Keys', () => {
  const f = ` function optionalKeys(T) { return union(Reflect.getReflection(T).properties.filter(p => p.optional).map(p => literal(p.name))); }`;
  expectBuilderTrue(kit(`${f}\n type X = { a: uint32, b?: string }; String(optionalKeys(X) === type 'b');`));
  expectBuilderTrue(kit(`${f}\n type X = { a: undefined, b?: undefined, c?: string, d?: null }; type Expected = 'b' | 'c' | 'd'; String(optionalKeys(X) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type X = {}; String(optionalKeys(X) === never);`));
});

// 114 - CamelCase - underscores introduce capitals; a trailing run keeps extras.
test('hard 114 - CamelCase', () => {
  const f = `    function camelCase(s) {
      return literal(s.toLowerCase().replace(/_+(.?)/g, (m, c) => c ? (m.length > 2 ? '_'.repeat(m.length - 2) + c.toUpperCase() : c.toUpperCase()) : ''));
    }`;
  expectBuilderTrue(kit(`${f}\n String(camelCase('FOOBAR') === type 'foobar');`));
  expectBuilderTrue(kit(`${f}\n String(camelCase('foo_bar') === type 'fooBar');`));
  expectBuilderTrue(kit(`${f}\n String(camelCase('foo__bar') === type 'foo_Bar');`));
});

// 300 - String to Number - a digit string to its literal number type, else never.
test('hard 300 - String to Number', () => {
  const f = ` function toNumber(s) { return /^\\d+$/.test(s) ? literal(Number(s)) : never; }`;
  expectBuilderTrue(kit(`${f}\n String(toNumber('0') === type 0);`));
  expectBuilderTrue(kit(`${f}\n String(toNumber('27') === type 27);`));
  expectBuilderTrue(kit(`${f}\n String(toNumber('18@7_$%') === never);`));
});

// 2822 - Split - split a string literal type by a separator into a tuple.
test('hard 2822 - Split', () => {
  const f = `    function split(T, sep) {
      const s = Reflect.getReflection(T).value;
      const parts = sep === undefined ? [s] : s.split(sep);
      return tupleOf(parts.map(p => literal(p)));
    }`;
  expectBuilderTrue(kit(`${f}\n type Expected = ['Hi! How are you?']; String(split(type 'Hi! How are you?') === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = ['Hi!', 'How', 'are', 'you?']; String(split(type 'Hi! How are you?', ' ') === Expected);`));
});

// 730 - Union to Tuple - a union to a tuple of its arms (order not specified).
test('hard 730 - Union to Tuple', () => {
  const f = ` function unionToTuple(U) { const n = Reflect.getReflection(U); return tupleOf(n.kind === 'union' ? n.arms : [U]); }`;
  // the length matches the arm count
  expectBuilderTrue(kit(`${f}\n type U = 'a' | 'b'; String(Reflect.getReflection(unionToTuple(U)).elements.length === 2);`));
  // re-unioning the tuple's elements recovers the union
  expectBuilderTrue(kit(`${f}
    type U = 'a' | 'b';
    String(union(elementTypes(unionToTuple(U))) === U);
  `));
  // a non-union becomes a one-element tuple
  expectBuilderTrue(kit(`${f}\n type Expected = [any]; String(unionToTuple(any) === Expected);`));
});
