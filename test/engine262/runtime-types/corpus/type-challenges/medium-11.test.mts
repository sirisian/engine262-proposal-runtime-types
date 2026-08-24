import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 11.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * String character algorithms, route/param parsing, BEM string generation, and
 * the numeric-key object challenge. Numeric object keys were enabled this shard:
 * `{ 1: T }` now parses and a numeric key canonicalizes to its string form
 * (`"1"`), as an object key does in JavaScript. Tuple operands are aliases.
 */


// 9142 - CheckRepeatedChars - any character occurs more than once.
test('medium 9142 - CheckRepeatedChars', () => {
  const f = 'function checkRepeatedChars(s) { return new Set(s).size !== s.length ? type true : type false; }';
  expectBuilderTrue(kit(`${f}\n String(checkRepeatedChars('abc') === type false);`));
  expectBuilderTrue(kit(`${f}\n String(checkRepeatedChars('abb') === type true);`));
  expectBuilderTrue(kit(`${f}\n String(checkRepeatedChars('') === type false);`));
});

// 9286 - FirstUniqueCharIndex - index of the first non-repeating character.
test('medium 9286 - FirstUniqueCharIndex', () => {
  const f = `    function firstUniqueCharIndex(s) { const chars = [...s]; return literal(chars.findIndex(c => chars.indexOf(c) === chars.lastIndexOf(c))); }`;
  expectBuilderTrue(kit(`${f}\n String(firstUniqueCharIndex('leetcode') === type 0);`));
  expectBuilderTrue(kit(`${f}\n String(firstUniqueCharIndex('loveleetcode') === type 2);`));
  expectBuilderTrue(kit(`${f}\n String(firstUniqueCharIndex('aabb') === type -1);`));
});

// 9616 - Parse URL Params - the `:name` segments as a union of literal types.
test('medium 9616 - Parse URL Params', () => {
  const f = `    function parseUrlParams(s) {
      const params = s.split('/').filter(p => p.startsWith(':')).map(p => p.slice(1));
      return params.length === 0 ? never : Reflect.makeType({ kind: 'union', arms: params.map(p => literal(p)) });
    }`;
  expectBuilderTrue(kit(`${f}\n String(parseUrlParams('') === never);`));
  expectBuilderTrue(kit(`${f}\n String(parseUrlParams('posts/:id') === type 'id');`));
  expectBuilderTrue(kit(`${f}\n type Expected = 'id' | 'user'; String(parseUrlParams('posts/:id/:user/like') === Expected);`));
});

// 3326 - BEM style string - block, elements, modifiers into a union of BEM class
// names.
test('medium 3326 - BEM style string', () => {
  const f = `    function bem(block, elements, modifiers) {
      const e = elements.length === 0 ? [''] : elements.map(x => '__' + x);
      const m = modifiers.length === 0 ? [''] : modifiers.map(x => '--' + x);
      const out = [];
      for (const el of e) { for (const mo of m) { out.push(literal(block + el + mo)); } }
      return Number(out.length) === 1 ? out[0] : Reflect.makeType({ kind: 'union', arms: out });
    }`;
  expectBuilderTrue(kit(`${f}\n String(bem('btn', ['price'], []) === type 'btn__price');`));
  expectBuilderTrue(kit(`${f}\n type Expected = 'btn__price--warning' | 'btn__price--success'; String(bem('btn', ['price'], ['warning', 'success']) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type Expected = 'btn--small' | 'btn--medium' | 'btn--large'; String(bem('btn', [], ['small', 'medium', 'large']) === Expected);`));
});

// 35045 - Longest Common Prefix - of a tuple of string literal types.
test('medium 35045 - Longest Common Prefix', () => {
  const f = `    function longestCommonPrefix(T) {
      const strings = Reflect.getReflection(T).elements.map(e => Reflect.getReflection(e.type).value);
      if (strings.length === 0) { return literal(''); }
      const first = strings[0];
      let i = 0;
      while (i < Number(first.length) && strings.every(s => s[i] === first[i])) { i += 1; }
      return literal(first.slice(0, i));
    }`;
  expectBuilderTrue(kit(`${f}\n type T = ['flower', 'flow', 'flight']; String(longestCommonPrefix(T) === type 'fl');`));
  expectBuilderTrue(kit(`${f}\n type T = ['dog', 'racecar', 'race']; String(longestCommonPrefix(T) === type '');`));
  expectBuilderTrue(kit(`${f}\n type T = ['a', 'a', '']; String(longestCommonPrefix(T) === type '');`));
});

// 34007 - Compare Array Length - sign of the length difference.
test('medium 34007 - Compare Array Length', () => {
  const f = `    function compareArrayLength(A, B) {
      const a = Reflect.getReflection(A).elements.length, b = Reflect.getReflection(B).elements.length;
      return literal(a > b ? 1 : a < b ? -1 : 0);
    }`;
  expectBuilderTrue(kit(`${f}\n type A = [1, 2, 3, 4]; type B = [5, 6]; String(compareArrayLength(A, B) === type 1);`));
  expectBuilderTrue(kit(`${f}\n type A = [1, 2]; type B = [3, 4, 5, 6]; String(compareArrayLength(A, B) === type -1);`));
  // two empty tuples compare equal; empty tuples are constructed
  expectBuilderTrue(kit(`${f}
    const empty = Reflect.makeType({ kind: 'tuple', elements: [] });
    function cmp(a, b) { return compareArrayLength(a, b); }
    String(compareArrayLength(empty, empty) === type 0);
  `));
});

// 9989 - Count Element Number To Object - count occurrences (recursing into
// nested tuples) into an object keyed by the numbers. Numeric keys enabled here.
test('medium 9989 - Count Element Number To Object', () => {
  const f = `    function countElementNumberToObject(T) {
      const counts = new Map();
      function walk(els) {
        for (const e of els) {
          const n = Reflect.getReflection(e.type);
          if (n.kind === 'tuple') { walk(n.elements); } else { counts.set(n.value, (counts.get(n.value) || 0) + 1); }
        }
      }
      walk(Reflect.getReflection(T).elements);
      const props = [...counts].map(([k, v]) => ({ name: String(k), type: literal(v), optional: false, readonly: false }));
      return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] });
    }`;
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3, 4, 5]; type Expected = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }; String(countElementNumberToObject(T) === Expected);`));
  expectBuilderTrue(kit(`${f}\n type T = [1, 2, 3, 4, 5, [1, 2, 3]]; type Expected = { 1: 2, 2: 2, 3: 2, 4: 1, 5: 1 }; String(countElementNumberToObject(T) === Expected);`));
});
