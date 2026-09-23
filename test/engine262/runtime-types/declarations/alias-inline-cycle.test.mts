import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

/**
 * Spec: #sec-type-alias-declarations with #sec-type-errors.
 *
 * "An alias may refer to itself, directly or through other aliases, provided
 * every cycle passes through a position that holds a reference rather than an
 * inline layout: a member written `T | null`, the element of a dynamic array, or
 * a field of a sealed class. It is a type error if a cycle never does, since the
 * type would demand an infinite inline layout, which is the same rule
 * #sec-typed-classes applies to a value type class containing itself."
 *
 * "The same rule" - and it was answered twice. `class A { x: A; }` was refused
 * by the checking pass, before the source ran; `type L = { next?: L };` reached
 * only `FirstInlineCycle` in the alias resolver and was a thrown *TypeError*
 * when the declaration evaluated. Both now run the same detector at check time.
 *
 * The timing is observable and is the point: an early error rejects the source
 * text, so a `try` around the declaration cannot catch it.
 */

test('an alias whose cycle closes inline is refused before the source runs', () => {
  expectStaticTypeError('type L = { next?: L };');
  expectStaticTypeError('type Bad = { self: Bad };');
  // Through other aliases, which is the "or through other aliases" half.
  expectStaticTypeError('type A = { b?: B }; type B = { a?: A };');
  // The annotation position does not matter: the rule is the alias's.
  expectStaticTypeError('type L = { next?: L }; function f(l: L) {}');
});

test('an optional member does not break a cycle', () => {
  // The clause's own note: "An OPTIONAL member does not break a cycle. `{ next?:
  // L }` demands the inline layout `{ next: L }` does, because a member that may
  // be ABSENT still needs room for the value where it is present."
  expectStaticTypeError('type L = { next?: L };');
  expectStaticTypeError('type L = { next: L };');
});

test('a fixed extent closes a cycle and a dynamic one does not', () => {
  // "the element of a dynamic array" is a reference position; a fixed extent
  // lays its elements inline and so keeps the cycle inline.
  expectStaticTypeError('type L = { kids: [2].<L> };');
  expect(ok('type L = { kids: [].<L> }; let l: L = { kids: [] };')).toBe(true);
});

test('a tuple position names itself by index', () => {
  // `contains itself through field ""` named nothing. A tuple position has no
  // key, so the index is what a reader can act on.
  expectStaticTypeError('type T = [uint8, T];');
  expect(evaluated('try { eval("type T = [uint8, T];"); "no error"; } catch (e) { e.message; }'))
    .toContain('through field "1"');
  // An outer member that already named the path keeps its name.
  expect(evaluated('try { eval("type L = { a: [uint8, L] };"); "no error"; } catch (e) { e.message; }'))
    .toContain('through field "a"');
});

test('the cycles the clause admits still stand', () => {
  // "a member written `T | null`" is the reference position that makes a linked
  // list expressible.
  expect(evaluated('type L = { value: uint8, next: L | null }; '
    + 'const n: L = { value: 1, next: { value: 2, next: null } }; String(n.next?.value);')).toBe('2');
  expect(ok('type L = { next?: L | null }; let l: L = {};')).toBe(true);
  // A class field is a reference position too.
  expect(ok('class C { x: uint8 = 1; } type A = { c: C | null }; let a: A = { c: null };')).toBe(true);
});

test('a generic alias is judged at its application, not at its declaration', () => {
  // Its body mentions a parameter no argument has bound, so whether a cycle
  // closes inline is not decided until it is applied - the deferral
  // #sec-evaluatetotypeobject draws for a type reading an unbound parameter.
  expect(evaluated('type Box<T: type> = { v: T }; let b: Box.<uint8> = { v: 1 }; String(b.v);')).toBe('1');
  // And the application is judged.
  expectStaticTypeError('type Box<T: type> = { v: T }; type L = Box.<L>;');
});

test('an interface is not walked, and that is not an omission', () => {
  // An interface is nominal, and a nominal is "a type whose own declaration owns
  // this rule" - an object satisfying `interface I { next?: I }` holds a
  // reference rather than an inline layout. The alias form is the inline one.
  expect(ok('interface I { next?: I }')).toBe(true);
});

test('an alias defined as itself keeps its own diagnostic', () => {
  // A different rule - "there is no structure to be recursive THROUGH" - and it
  // must not be captured by the cycle walk. Forcing resolution here once made
  // this report a ReferenceError against an unbound name instead.
  expect(evaluated('try { eval("type L = L;"); "no error"; } catch (e) { e.constructor.name + ": " + e.message; }'))
    .toBe('TypeError: "L" is defined as itself, so it denotes no type');
});
