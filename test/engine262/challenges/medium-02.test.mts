import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges — the medium tier, shard 2.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * String transforms (a value in, a literal type out) and object utilities
 * (getReflection + makeType over properties), ported in corpus builder form.
 * `type` operator on literal operands and the kit primitives carry these. Where
 * the corpus writes `type 'x'` for a key operand it is used directly (the
 * operator now accepts literals); tuple/paren operands, where any, are aliases.
 */

const KIT = `
function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }
function objectOf(props) { return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] }); }
function keysSet(T) { return new Set(Reflect.getReflection(T).properties.map(p => p.name)); }
function props(T) { return Reflect.getReflection(T).properties; }
function merge(A, B) { const bk = keysSet(B); return objectOf([...props(A).filter(p => !bk.has(p.name)), ...props(B)]); }
`;
const kit = (p: string) => `${KIT}\n${p}`;

// 116 · Replace — replace the first occurrence; empty `from` is identity.
test('medium 116 · Replace', () => {
  expectBuilderTrue(kit(`
    function replace(s, from, to) { return literal(from === '' ? s : s.replace(from, () => to)); }
    String(replace('foobarbar', 'bar', 'foo') === type 'foofoobar');
  `));
  expectBuilderTrue(kit(`
    function replace(s, from, to) { return literal(from === '' ? s : s.replace(from, () => to)); }
    String(replace('foobarbar', 'bra', 'foo') === type 'foobarbar');
  `));
  expectBuilderTrue(kit(`
    function replace(s, from, to) { return literal(from === '' ? s : s.replace(from, () => to)); }
    String(replace('foobarbar', '', 'foo') === type 'foobarbar');
  `));
});

// 119 · ReplaceAll — replace every occurrence.
test('medium 119 · ReplaceAll', () => {
  expectBuilderTrue(kit(`
    function replaceAll(s, from, to) { return literal(from === '' ? s : s.replaceAll(from, () => to)); }
    String(replaceAll('foobarbar', 'bar', 'foo') === type 'foofoofoo');
  `));
  expectBuilderTrue(kit(`
    function replaceAll(s, from, to) { return literal(from === '' ? s : s.replaceAll(from, () => to)); }
    String(replaceAll('t y p e s', ' ', '') === type 'types');
  `));
  expectBuilderTrue(kit(`
    function replaceAll(s, from, to) { return literal(from === '' ? s : s.replaceAll(from, () => to)); }
    String(replaceAll('foobarbar', '', 'foo') === type 'foobarbar');
  `));
});

// 529 · Absolute — the magnitude of a number/bigint/string as a string literal
// type. String(n) then strip a leading '-' and a bigint 'n' suffix.
test('medium 529 · Absolute', () => {
  expectBuilderTrue(kit(`
    function absolute(n) { return literal(String(n).replace('-', '').replace('n', '')); }
    String(absolute(-5) === type '5');
  `));
  expectBuilderTrue(kit(`
    function absolute(n) { return literal(String(n).replace('-', '').replace('n', '')); }
    String(absolute(-1000000n) === type '1000000');
  `));
  expectBuilderTrue(kit(`
    function absolute(n) { return literal(String(n).replace('-', '').replace('n', '')); }
    String(absolute('-5') === type '5');
  `));
});

// 612 · KebabCase — insert '-' before each capital and lowercase it.
test('medium 612 · KebabCase', () => {
  expectBuilderTrue(kit(`
    function kebabCase(s) { return literal(s.replace(/([A-Z])/g, (m, c, i) => (i ? '-' : '') + c.toLowerCase())); }
    String(kebabCase('FooBarBaz') === type 'foo-bar-baz');
  `));
  expectBuilderTrue(kit(`
    function kebabCase(s) { return literal(s.replace(/([A-Z])/g, (m, c, i) => (i ? '-' : '') + c.toLowerCase())); }
    String(kebabCase('ABC') === type 'a-b-c');
  `));
});

// 599 · Merge — B's properties override A's, then A's remaining are kept.
test('medium 599 · Merge', () => {
  expectBuilderTrue(kit(`
    type Foo = { a: uint32, b: uint32 };
    type Bar = { b: uint32, c: boolean };
    type Expected = { a: uint32, b: uint32, c: boolean };
    String(merge(Foo, Bar) === Expected);
  `));
});

// 527 · Append to object — add one property.
test('medium 527 · Append to object', () => {
  expectBuilderTrue(kit(`
    function appendToObject(T, k, V) { return objectOf([...props(T), { name: k, type: V, optional: false }]); }
    type Test = { key: 'cat', value: 'green' };
    type Expected = { key: 'cat', value: 'green', home: boolean };
    String(appendToObject(Test, 'home', boolean) === Expected);
  `));
});

// 645 · Diff — the properties in exactly one of the two objects.
test('medium 645 · Diff', () => {
  expectBuilderTrue(kit(`
    function omit(T, keySet) { return objectOf(props(T).filter(p => !keySet.has(p.name))); }
    type Foo = { name: uint32, age: string };
    type Coo = { name: uint32, gender: uint32 };
    type Expected = { age: string, gender: uint32 };
    String(merge(omit(Foo, keysSet(Coo)), omit(Coo, keysSet(Foo))) === Expected);
  `));
});

// 62 · Type Lookup — the union arm whose discriminant property `type` is K.
test('medium 62 · Type Lookup', () => {
  const lookup = `
    function lookUp(U, K) {
      for (const a of Reflect.getReflection(U).arms) {
        const tp = Reflect.getReflection(a).properties.find(p => p.name === 'type');
        if (tp && tp.type === K) return a;
      }
      return never;
    }
    type Dog = { type: 'dog', barks: boolean };
    type Cat = { type: 'cat', meows: boolean };
    type Animal = Dog | Cat;
  `;
  expectBuilderTrue(kit(`${lookup}\n String(lookUp(Animal, type 'dog') === Dog);`));
  expectBuilderTrue(kit(`${lookup}\n String(lookUp(Animal, type 'cat') === Cat);`));
  expectBuilderTrue(kit(`${lookup}\n String(lookUp(Animal, type 'bird') === never);`));
});
