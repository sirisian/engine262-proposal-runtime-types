import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-generator-types (Generator Types).
 *
 * Owed to the generator forms the core already parses rather than to do
 * expressions, and missing from this engine in the same way it was missing from
 * the specification. The core admitted a return annotation on a generator and
 * said what it meant in prose - "a generator's annotation types the values the
 * iterator yields" - while `Generator.<Y, R, N>` had no Type Record, so nothing
 * said what a call of a generator returns or what a `yield` evaluates to. The
 * checker declined outright: "a generator or async literal's result is an
 * iterator or a promise, not the returned value; those judgments are not this
 * operation's business."
 *
 * They are its business now, because `do *` computes one.
 */

test('Generator and AsyncGenerator resolve as types', () => {
  expect(ok('type G = Generator.<uint8, void, void>;')).toBe(true);
  expect(ok('type A = AsyncGenerator.<uint8, void, void>;')).toBe(true);
  // An alias, since a binding of a library nominal has no default to take.
  expect(ok('type G = Generator.<uint8, void, void>;')).toBe(true);
});

test('they intern by name and arguments, and are invariant', () => {
  expect(evaluated(`
    type A = Generator.<uint8, void, void>;
    type B = Generator.<uint8, void, void>;
    String(A === B);
  `)).toBe('true');

  // A generic class is invariant in its arguments (#sec-issubtype), so two
  // instantiations are unrelated however their arguments relate.
  expect(evaluated(`
    type A = Generator.<uint8, void, void>;
    type B = Generator.<uint16, void, void>;
    String(A === B);
  `)).toBe('false');

  // And a Generator is not an AsyncGenerator.
  expect(evaluated(`
    type A = Generator.<uint8, void, void>;
    type B = AsyncGenerator.<uint8, void, void>;
    String(A === B);
  `)).toBe('false');
});

test('a bare return annotation is the SHORTHAND for the yield type', () => {
  // `function* f(): int32` declares a Generator.<int32, void, void>, which is
  // the design's choice and the useful one: a generator's return and next types
  // are void in almost every generator anyone writes.
  expect(ok(`
    function* f(): uint8 { yield 1; }
    let g: Generator.<uint8, void, void> = f();
  `)).toBe(true);

  // The shorthand is a real type, so the wrong yield type is refused.
  expect(ok(`
    function* f(): uint8 { yield 1; }
    let g: Generator.<uint16, void, void> = f();
  `)).toBe(false);
});

test('a full annotation is taken as written', () => {
  expect(ok(`
    function* f(): Generator.<uint8, string, boolean> { yield 1; return 'x'; }
    let g: Generator.<uint8, string, boolean> = f();
  `)).toBe(true);
});

test('an annotation naming the wrong protocol is an error', () => {
  // A Generator annotation on an async generator, and the reverse: the
  // annotation names a protocol the function does not have.
  expect(ok('async function* f(): Generator.<uint8, void, void> { yield 1; }')).toBe(false);
  expect(ok('function* f(): AsyncGenerator.<uint8, void, void> { yield 1; }')).toBe(false);
  // Each with its own form is fine.
  expect(ok('async function* f(): AsyncGenerator.<uint8, void, void> { yield 1; }')).toBe(true);
  expect(ok('function* f(): Generator.<uint8, void, void> { yield 1; }')).toBe(true);
});

test('a yield expression evaluates to N', () => {
  // What a caller sends to `next`, which is the third argument.
  expect(ok(`
    function* f(): Generator.<uint8, void, string> { const s: string = yield 1; }
  `)).toBe(true);
  expect(ok(`
    function* f(): Generator.<uint8, void, string> { const s: uint8 = yield 1; }
  `)).toBe(false);
});

test('a yield* evaluates to the DELEGATED generator\'s R', () => {
  // The rule everyone gets backwards. It follows from the run time: `yield*`
  // drives the operand to completion and takes its RETURN value, while what it
  // yields passes through to the enclosing generator's consumer.
  expect(ok(`
    function* inner(): Generator.<uint8, string, void> { return 'x'; }
    function* outer(): uint8 { const r: string = yield* inner(); }
  `)).toBe(true);

  // Not the yield type, which is what a reader expects and what would make the
  // delegation look like a loop over the values.
  expect(ok(`
    function* inner(): Generator.<uint8, string, void> { return 'x'; }
    function* outer(): uint8 { const r: uint8 = yield* inner(); }
  `)).toBe(false);
});

test('generators still run', () => {
  // The types are static; nothing about evaluation changed.
  expect(evaluated('function* f(): uint8 { yield 1; yield 2; } String([...f()]);')).toBe('1,2');
  expect(evaluated(`
    function* inner(): Generator.<uint8, void, void> { yield 1; }
    function* outer(): uint8 { yield* inner(); yield 2; }
    String([...outer()]);
  `)).toBe('1,2');
});

test('an unannotated generator INFERS its return type', () => {
  // #sec-inferred-result-type: "_R_ is the join of its return contributions",
  // said in the same breath as "_N_ is not inferred, being the type of what a
  // caller sends IN". So _R_ was meant to be inferred where no annotation
  // supplies it, and it was defaulted to `void` BEFORE the body was walked -
  // which refused `function* g() { yield 1; return "done"; }`, ordinary
  // JavaScript, with "a literal type of string is not assignable to void".
  //
  // The contributions are collected by the same walk `do*` expressions already
  // use, where #sec-do-generator-expressions says "Y, R, and N are found rather
  // than declared".
  expect(evaluated('function* g() { yield (1 := uint8); return "d"; } String(typeof g);')).toBe('function');
  expect(evaluated('function* g() { yield "a"; return (1 := uint8); } String(typeof g);')).toBe('function');
  // Two returns join.
  expect(evaluated('function* g(b) { yield "a"; if (b) { return (1 := uint8); } return "s"; } String(typeof g);')).toBe('function');
  // An ASYNC generator infers it too.
  expect(evaluated('async function* g() { yield (1 := uint8); return "d"; } String(typeof g);')).toBe('function');
});

test('a generator with NO return keeps `void`', () => {
  // The verification step this change was gated on: an empty contribution set
  // must reach `void` and not `undefined`, or inferring _R_ would refuse
  // `function* g() { yield 1; }` - the commonest generator there is. It is the
  // same join question #sec-inferred-result-type answers for ordinary
  // functions, and getting it wrong cost an earlier attempt on block-bodied
  // arrows.
  expect(evaluated('function* g() { yield (1 := uint8); } String(typeof g);')).toBe('function');
  expect(evaluated('function* g() { } String(typeof g);')).toBe('function');
});

test('an ANNOTATION still wins over the inference', () => {
  // Inference fills in what no annotation supplies; it does not override one.
  // A generator declared to return `void` and returning a String is still an
  // error, which is what says the change is about the DEFAULT and not about the
  // check.
  expectStaticTypeError('function* g(): Generator.<uint8, void, void> { yield (1 := uint8); return "no"; } g();');
  expect(evaluated('function* g(): Generator.<uint8, string, void> { yield (1 := uint8); return "d"; } String(typeof g);')).toBe('function');
});
