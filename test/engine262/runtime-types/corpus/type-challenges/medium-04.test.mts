import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 4.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * String predicates and transforms, tuple operations, and a reflect-kind check.
 * Same patterns as shards 1-3: string value in / literal or boolean type out;
 * tuple manipulation via elementTypes + tupleOf; `type true`/`type false` for
 * boolean-typed answers. Tuple and dynamic-array operands are type aliases (the
 * `type [...]` and `[].<T>`-in-expression limitations), noted where used.
 */

const L = `function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }`;
const TUP = `
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
function elementTypes(T) { return Reflect.getReflection(T).elements.map(e => e.type); }
`;

// 2688 - StartsWith - string prefix test.
test('medium 2688 - StartsWith', () => {
  const f = 'function startsWith(s, p) { return s.startsWith(p) ? type true : type false; }';
  expectBuilderTrue(`${f}\n String(startsWith('abc', 'ab') === type true);`);
  expectBuilderTrue(`${f}\n String(startsWith('abc', 'ac') === type false);`);
  expectBuilderTrue(`${f}\n String(startsWith('abc', '') === type true);`);
});

// 2693 - EndsWith - string suffix test.
test('medium 2693 - EndsWith', () => {
  const f = 'function endsWith(s, p) { return s.endsWith(p) ? type true : type false; }';
  expectBuilderTrue(`${f}\n String(endsWith('abc', 'bc') === type true);`);
  expectBuilderTrue(`${f}\n String(endsWith('abc', 'ac') === type false);`);
  expectBuilderTrue(`${f}\n String(endsWith('abc', '') === type true);`);
});

// 4803 - Trim Right - strip trailing whitespace.
test('medium 4803 - Trim Right', () => {
  expectBuilderTrue(`${L}
    function trimRight(s) { return literal(s.replace(/\\s+$/, '')); }
    String(trimRight('     str     ') === type '     str');
  `);
});

// 2070 - Drop Char - remove every occurrence of a character.
test('medium 2070 - Drop Char', () => {
  expectBuilderTrue(`${L}
    function dropChar(s, c) { return literal(s.split(c).join('')); }
    String(dropChar('butter fly!', ' ') === type 'butterfly!');
  `);
  expectBuilderTrue(`${L}
    function dropChar(s, c) { return literal(s.split(c).join('')); }
    String(dropChar(' b u t t e r f l y ! ', 't') === type ' b u   e r f l y ! ');
  `);
});

// 4484 - IsTuple - reflect the kind. A dynamic array, an object, and never are
// not tuples. (Dynamic-array operand is an alias.)
test('medium 4484 - IsTuple', () => {
  const f = "function isTuple(T) { return Reflect.getReflection(T).kind === 'tuple' ? type true : type false; }";
  expectBuilderTrue(`${f}\n type T = [uint32]; String(isTuple(T) === type true);`);
  expectBuilderTrue(`${f}\n type A = [].<uint32>; String(isTuple(A) === type false);`);
  expectBuilderTrue(`${f}\n String(isTuple(never) === type false);`);
});

// 3062 - Shift - the tuple without its first element (tail).
test('medium 3062 - Shift', () => {
  const f = `${TUP}\n function shift(T) { return tupleOf(elementTypes(T).slice(1)); }`;
  expectBuilderTrue(`${f}\n type T = [3, 2, 1]; type Expected = [2, 1]; String(shift(T) === Expected);`);
  // a single-element tuple shifts to an empty tuple (constructed, not `type []`)
  expectBuilderTrue(`${f}\n type T = [1]; String(shift(T) === Reflect.makeType({ kind: 'tuple', elements: [] }));`);
});

// 3192 - Reverse - the tuple element types reversed.
test('medium 3192 - Reverse', () => {
  const f = `${TUP}\n function reverse(T) { return tupleOf(elementTypes(T).slice().reverse()); }`;
  expectBuilderTrue(`${f}\n type T = ['a', 'b', 'c']; type Expected = ['c', 'b', 'a']; String(reverse(T) === Expected);`);
});

// 5310 - Join - join tuple element literal values with a separator.
test('medium 5310 - Join', () => {
  const f = `${L}
    function join(T, sep) {
      const vals = Reflect.getReflection(T).elements.map(e => Reflect.getReflection(e.type).value);
      return literal(vals.join(sep === undefined ? ',' : String(sep)));
    }`;
  expectBuilderTrue(`${f}\n type T = ['a', 'p', 'p', 'l', 'e']; String(join(T, '-') === type 'a-p-p-l-e');`);
  expectBuilderTrue(`${f}\n type T = ['2', '2', '2']; String(join(T, 1) === type '21212');`);
  expectBuilderTrue(`${f}\n type T = ['o']; String(join(T, 'u') === type 'o');`);
  expectBuilderTrue(`${f}\n type T = ['1', '1', '1']; String(join(T) === type '1,1,1');`);
});
