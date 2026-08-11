import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 1.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * This shard ports the medium challenges expressible in their true corpus
 * builder form, over the `type` operator with literal operands and the
 * primitives keyof / getReflection / makeType / isAssignable and the kit. Each builder is written close to the corpus, and its assertions run
 * with `===` (interning). Both operands the corpus reaches for are spellable
 * now: a TUPLE (`type [3,2,1]`), since #sec-types-in-expression-position leaves
 * `(` as the only cover-grammar case and so `[` belongs to the operator, and a
 * FUNCTION TYPE (`type (uint8) => uint8`), refined out of that cover at the
 * token after the `)`. A PARENTHESIZED non-function operand (`type ('a'|'b')`)
 * is neither refinement and stays a call, so a union operand is written
 * unparenthesized - `type 'a' | 'b'`, the operand reaching as far as it can.
 * Remaining medium challenges are in later shards; ones blocked on an unbuilt
 * primitive are named there.
 *
 * The kit source (over the primitives) prepended where a builder uses it.
 */

const KIT = `
function arms(T) { const n = Reflect.getReflection(T); return n.kind === 'union' ? n.arms : [T]; }
function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }
function elementTypes(T) { return Reflect.getReflection(T).elements.map(e => e.type); }
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
`;
const kit = (p: string) => `${KIT}\n${p}`;

// 1042 - IsNever - T === never ? true : false. `T === never` is a pointer
// comparison; the tuple-wrapping the TypeScript solution needs (to dodge
// distribution over never) has nothing to do here. Fully in builder form.
test('medium 1042 - IsNever', () => {
  expectBuilderTrue(`
    function isNever(T) { return T === never ? type true : type false; }
    String(isNever(never) === type true);
  `);
  expectBuilderTrue(`
    function isNever(T) { return T === never ? type true : type false; }
    String(isNever(type '') === type false);
  `);
  // never | string is just string (never is the union identity), so not never
  expectBuilderTrue(`
    function isNever(T) { return T === never ? type true : type false; }
    type U = never | string;
    String(isNever(U) === type false);
  `);
});

// 1097 - IsUnion - a type is a union with more than one arm.
test('medium 1097 - IsUnion', () => {
  expectBuilderTrue(`
    function isUnion(T) {
      const n = Reflect.getReflection(T);
      return n.kind === 'union' && n.arms.length > 1 ? type true : type false;
    }
    type U = 'a' | 'b';
    String(isUnion(U) === type true);
  `);
  expectBuilderTrue(`
    function isUnion(T) {
      const n = Reflect.getReflection(T);
      return n.kind === 'union' && n.arms.length > 1 ? type true : type false;
    }
    String(isUnion(string) === type false);
  `);
});

// 531 - String to Union - each character becomes a literal type, unioned.
test('medium 531 - String to Union', () => {
  expectBuilderTrue(kit(`
    function stringToUnion(s) { return union([...s].map(c => literal(c))); }
    type Expected = 'h' | 'e' | 'l' | 'o';
    String(stringToUnion('hello') === Expected);
  `));
  expectBuilderTrue(kit(`
    function stringToUnion(s) { return union([...s].map(c => literal(c))); }
    String(stringToUnion('t') === type 't');
  `));
  expectBuilderTrue(kit(`
    function stringToUnion(s) { return union([...s].map(c => literal(c))); }
    String(stringToUnion('') === never);
  `));
});

// 106 - Trim Left - a string value in, the trimmed string's literal type out.
// Argument-bound value generics give the exercise the string itself.
test('medium 106 - Trim Left', () => {
  expectBuilderTrue(kit(`
    function trimLeft(s) { return literal(s.replace(/^\\s+/, '')); }
    String(trimLeft('     str     ') === type 'str     ');
  `));
  expectBuilderTrue(kit(`
    function trimLeft(s) { return literal(s.replace(/^\\s+/, '')); }
    String(trimLeft(' \\n\\t') === type '');
  `));
});

// 108 - Trim - both ends.
test('medium 108 - Trim', () => {
  expectBuilderTrue(kit(`
    function trim(s) { return literal(s.trim()); }
    String(trim('   foo bar   ') === type 'foo bar');
  `));
});

// 110 - Capitalize - first character uppercased.
test('medium 110 - Capitalize', () => {
  expectBuilderTrue(kit(`
    function capitalize(s) { return literal(s.length ? s[0].toUpperCase() + s.slice(1) : s); }
    String(capitalize('foo bar') === type 'Foo bar');
  `));
  expectBuilderTrue(kit(`
    function capitalize(s) { return literal(s.length ? s[0].toUpperCase() + s.slice(1) : s); }
    String(capitalize('') === type '');
  `));
});

// 298 - Length of String - the length as a literal number type.
test('medium 298 - Length of String', () => {
  expectBuilderTrue(kit(`
    function lengthOfString(s) { return literal(s.length); }
    String(lengthOfString('Sound! Euphonium') === type 16);
  `));
  expectBuilderTrue(kit(`
    function lengthOfString(s) { return literal(s.length); }
    String(lengthOfString('') === type 0);
  `));
});

// 15 - Last of Array - the last element type, or never for empty. Written in
// the corpus's own form, `last(type [3,2,1])`, now that a tuple operand parses.
test('medium 15 - Last of Array', () => {
  expectBuilderTrue(kit(`
    function last(T) { const els = elementTypes(T); return els.length ? els[els.length - 1] : never; }
    String(last(type [3, 2, 1]) === type 1);
  `));
  expectBuilderTrue(kit(`
    function last(T) { const els = elementTypes(T); return els.length ? els[els.length - 1] : never; }
    String(last(type [2]) === type 2);
  `));
});

// 16 - Pop - the tuple without its last element.
test('medium 16 - Pop', () => {
  expectBuilderTrue(kit(`
    function pop(T) { return tupleOf(elementTypes(T).slice(0, -1)); }
    type T = [3, 2, 1];
    type Expected = [3, 2];
    String(pop(T) === Expected);
  `));
  expectBuilderTrue(kit(`
    function pop(T) { return tupleOf(elementTypes(T).slice(0, -1)); }
    type T = ['a', 'b', 'c', 'd'];
    type Expected = ['a', 'b', 'c'];
    String(pop(T) === Expected);
  `));
});

// 949 - AnyOf - true when any tuple element is a truthy-typed value. The corpus
// tests literal falsy/truthy element types, in its own tuple-operand spelling.
test('medium 949 - AnyOf', () => {
  // a tuple with a truthy element (1) is true
  expectBuilderTrue(kit(`
    function anyOf(T) {
      const falsy = new Set([0, '', false]);
      return elementTypes(T).some(e => {
        const n = Reflect.getReflection(e);
        return n.kind === 'literal' ? !falsy.has(n.value) : true;
      }) ? type true : type false;
    }
    String(anyOf(type [0, '', false, 1]) === type true);
  `));
  // all falsy is false
  expectBuilderTrue(kit(`
    function anyOf(T) {
      const falsy = new Set([0, '', false]);
      return elementTypes(T).some(e => {
        const n = Reflect.getReflection(e);
        return n.kind === 'literal' ? !falsy.has(n.value) : true;
      }) ? type true : type false;
    }
    type T = [0, '', false];
    String(anyOf(T) === type false);
  `));
});
