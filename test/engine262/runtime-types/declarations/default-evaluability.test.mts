import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

/**
 * Spec: #sec-array-and-tuple-types and #sec-object-types with
 * #annex-evaluable-fragment and #sec-evaluatetotypeobject.
 *
 * Both clauses say the same thing of a default: "The |Initializer| must be
 * compile-time evaluable ... and it is a type error otherwise." The fragment has
 * two halves and only one of them was reaching the checking pass.
 *
 * The SYNTACTIC half - `eval`, a class expression, an await - is a walk over the
 * parse tree and was already decided here. The LIBRARY half - "a built-in is
 * within the fragment when its result is determined by its arguments ... and it
 * depends on no host or ambient state" - is a judgment about built-ins, enforced
 * on the FUNCTION at the call rather than on the call syntax, so only evaluating
 * the default decides it.
 *
 * Two things stopped that evaluation happening. The pass's default-conversion
 * loop guarded with an EMPTY allowed set, so any default naming a global was
 * skipped and `Math` is a global; and a default that did not fold to a literal
 * was recorded nowhere, so the loop never saw it. The allowed set is now the
 * annex's own floor, and an unfolded default is recorded where its type is
 * built.
 *
 * #sec-evaluatetotypeobject is why the failure is reported rather than
 * discarded: an abrupt completion makes the result ~empty~, and ~empty~ in type
 * position is a type error.
 */

test('a default calling an excluded built-in is refused', () => {
  expectStaticTypeError('type T = [uint8 = Math.random()];');
  expectStaticTypeError('type T = { a?: uint8 = Math.random() };');
  expectStaticTypeError('type F = (a: uint8 = Math.random()) => void;');
});

test('the refusal reaches the positions that demand no default value', () => {
  // A binding of the type demands its default and so recorded it; a parameter
  // and a return annotation demand nothing, so nothing was recorded and the
  // rule went unjudged there. Those are the positions the move is for.
  expectStaticTypeError('function f(t: [uint8 = Math.random()]) {}');
  expectStaticTypeError('function f(): [uint8 = Math.random()] { return []; }');
  expectStaticTypeError('function f(o: { a?: uint8 = Math.random() }) {}');
  expectStaticTypeError('let t: [uint8 = Math.random()];');
});

test('the library floor stays usable in a default', () => {
  // The annex's floor: "the pure methods and functions of String, Number,
  // BigInt, Math, Array, Object, and JSON". A default may call these.
  expect(evaluated('type T = [uint8 = Math.max(1, 2)]; let t: T = []; String(t[0]);')).toBe('2');
  expect(evaluated("type T = [uint8 = JSON.parse('2')]; let t: T = []; String(t[0]);")).toBe('2');
  expect(evaluated('function f(t: [uint8 = Math.max(1, 2)]) { return t; } String(typeof f);')).toBe('function');
});

test('the ordinary defaults are untouched', () => {
  expect(evaluated('type T = [uint8 = 1]; let t: T = []; String(t[0]);')).toBe('1');
  expect(evaluated('type T = [uint8 = 1 + 2]; let t: T = []; String(t[0]);')).toBe('3');
  expect(evaluated('type T = { a?: uint8 = 1 }; let o: T = {}; String(o.a);')).toBe('1');
  expect(evaluated("type T = { s?: string = 'x' }; let o: T = {}; o.s;")).toBe('x');
  // A default naming a user binding folds to its value and is checked that way.
  expect(evaluated('const K = 3; type T = [uint8 = K]; let t: T = []; String(t[0]);')).toBe('3');
});

test('a default in a generic type is judged at its application', () => {
  // Its position type mentions a parameter no argument has bound, so the
  // deferral of #sec-evaluatetotypeobject applies as it does everywhere else.
  expect(evaluated('type T<X: type> = [X, uint8 = 1]; let t: T.<uint8> = [1]; String(t[1]);')).toBe('1');
  expect(evaluated('type T<X: type> = { a: X, b?: uint8 = 1 }; let t: T.<uint8> = { a: 1 }; String(t.b);')).toBe('1');
});

test('the syntactic half keeps its own diagnostic', () => {
  // Decided by the parse-tree walk, which names the form. The library half
  // names the built-in instead, so the two are told apart by their messages.
  expect(ok("type T = [uint8 = eval('1')];")).toBe(false);
  expect(ok('type T = [uint8 = (class {})];')).toBe(false);
});
