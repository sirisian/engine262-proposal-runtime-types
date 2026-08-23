import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * proposal-runtime-types, PLAN-constructor-returns.md phase 2.
 *
 * Phase 1 refused `return <expr>` in a TYPED class's constructor (OQ1-E). This
 * file pins WHERE that line falls (OQ2-B): a typed class is one carrying at
 * least one type annotation, and an untyped class keeps JavaScript's semantics
 * unchanged. The second half is what keeps the proposal a superset, so it is
 * asserted here rather than assumed.
 *
 * The measurement that justifies the line, run in phase 2:
 *
 *   test262 `language/statements/class` - 4367 files, 205 constructors, 25 with
 *   a `return <expr>`. Of those 25, three are `new Proxy(this, ...)` and about
 *   nine return a primitive or `undefined` to assert that JavaScript DISCARDS
 *   it. NONE of them carries a type annotation, so none is a typed class and
 *   NONE BREAKS. The cliff is not "code that returns from a constructor", it is
 *   the intersection of that with "code that annotates", and in a conformance
 *   suite written in plain JavaScript the intersection is empty.
 *
 *   Note the suite over-represents the pattern by construction - it exists to
 *   exercise edge cases - so 25/205 is an upper bound on how often the form
 *   appears, not an estimate of how often real code uses it.
 *
 * The one real instance found in an annotated codebase was this engine's own
 * `src/completion.mts`, and it is worth recording because it is the pattern's
 * best case rather than its worst: a base constructor that DISPATCHES to a
 * subclass, guarded by `new.target === CompletionImpl` so that `super()` from a
 * real subclass skips the dispatch. Every object it returns is an instance of
 * the class, so it is sound - and it is sound because of a RUNTIME guard no
 * static rule can see. That is the argument for refusing rather than checking,
 * restated from the other direction: the disciplined form of this pattern is
 * safe for a reason the checker cannot verify, so a static rule must either
 * forbid it or trust it. Its migration is a static factory over a private
 * constructor, which is what `completion.mts` already exposes as
 * `NormalCompletion(...)`.
 */

/**
 * The rule is an EARLY error, so the program never runs and the refusal is not
 * catchable - which is what `expectStaticTypeError` checks for, wrapping the
 * source in a `try` that a runtime throw would have swallowed.
 */
const expectEarlyError = (source: string) => expectStaticTypeError(source);

test('an UNTYPED class keeps JavaScript semantics - the superset property', () => {
  // The whole compatibility story in one assertion. If this ever fails, the
  // proposal has stopped being a superset and every test262 program above is at
  // risk, not just this one.
  expect(evaluated('class C { constructor() { return { a: 1 }; } }'
    + ' String(JSON.stringify(new C()));')).toBe('{"a":1}');
  // including the Proxy idiom, the one pattern OQ1-E costs a typed class
  expect(evaluated('class C { constructor() { return new Proxy(this, {}); } }'
    + ' String(typeof new C());')).toBe('object');
  // and the primitive returns test262 uses to assert JavaScript discards them
  expect(evaluated('class C { constructor() { return 42; } } String(new C() instanceof C);')).toBe('true');
});

test('a decorator does not make a class typed', () => {
  // A decorator is not a type annotation. If this flipped, enabling decorators
  // would silently enable a type rule, which is two features leaking into each
  // other.
  expect(evaluated('function d(v) { return v; }'
    + ' class C { @d m() {} constructor() { return { a: 1 }; } }'
    + ' String(new C() instanceof C);')).toBe('false');
});

test('a class is typed when an INSTANCE FIELD is annotated - #sec-typed-classes', () => {
  // Phase 2 decided this line independently and drew it wider: any annotation
  // anywhere. Phase 4 corrected it, because #sec-typed-classes ALREADY defines
  // the term - "at least one of its public or private fields carries a type
  // annotation" - and that definition has teeth elsewhere: a typed class "is
  // automatically sealed and its prototype frozen", implemented as
  // [[SealInstances]]. The wider reading gave one term two meanings, with the
  // constructor rule and the sealing rule disagreeing about which classes they
  // covered.
  const returns = ' constructor() { return { a: 1 }; } }';
  expectEarlyError('class C { x: uint8 = 1;' + returns);
  expectEarlyError('class C { #x: uint8 = 1;' + returns);
});

test('and NOT typed by an annotation that says nothing about an instance', () => {
  // The cost of the alignment, asserted rather than left to be discovered. A
  // class annotated only on a static field, a method, a getter, or a
  // constructor parameter is not typed, so F122's hole stays open there.
  //
  // It is the right residual. The layout argument - the strongest one, and the
  // one specific to this proposal - is about what a construction PRODUCES, and
  // only a field annotation makes an instance's shape a fact. Where the rule
  // does not reach, the class is extensible and unsealed, which is the same
  // category an untyped class is in.
  //
  // A `static` field is excluded for the reason the engine excludes it from
  // sealing: it is not on the instance.
  const returns = ' constructor() { return { a: 1 }; } }';
  expect(evaluated('class C { static s: uint8 = 1;' + returns + ' String(new C() instanceof C);')).toBe('false');
  expect(evaluated('class C { m(): uint8 { return 1; }' + returns + ' String(new C() instanceof C);')).toBe('false');
  expect(evaluated('class C { get g(): uint8 { return 1; }' + returns + ' String(new C() instanceof C);')).toBe('false');
  expect(evaluated('class C { constructor(y: uint8) { return { a: 1 }; } }'
    + ' String(new C(1) instanceof C);')).toBe('false');
  // and the sealing rule agrees with the constructor rule on every one of them,
  // which is the property the correction bought
  for (const decl of [
    'class C { static s: uint8 = 1; }',
    'class C { m(): uint8 { return 1; } }',
    'class C { constructor(y: uint8) {} }',
  ]) {
    expect(evaluated(`${decl} String(Object.isExtensible(new C(1)));`), decl).toBe('true');
  }
  expect(evaluated('class C { x: uint8 = 1; } String(Object.isExtensible(new C()));')).toBe('false');
});

test('the annotation may come AFTER the constructor', () => {
  // Typed-ness is a property of the class, not of the text before the
  // constructor, so the rule is applied once the class body ends. An
  // implementation that checked at the `return` would miss this.
  expectEarlyError('class C { constructor() { return { a: 1 }; } x: uint8 = 1; }');
});

test('a class EXPRESSION is caught at the `return`, not at its binding', () => {
  // This case already failed before phase 1, but at the wrong place and for the
  // wrong reason: `const K = class { ... }; let k: K = new K();` threw
  // "[object Object] is not assignable to nominal" at the ASSIGNMENT, because a
  // class expression's type resolves through its binding and so never got the
  // false static proof that let the declaration form through (F122).
  //
  // So phase 1 does not add enforcement here; it MOVES the diagnostic to the
  // offence and makes it independent of whether the value is ever assigned.
  expectEarlyError('const K = class { x: uint8 = 1; constructor() { return { a: 1 }; } };');
  // no binding, no assignment, still refused
  expectEarlyError('(class { x: uint8 = 1; constructor() { return { a: 1 }; } });');
});

test('nesting: only the constructor\'s OWN returns count', () => {
  // The collector is scoped at the function body, so an inner function, arrow,
  // or nested class carries its own. Getting this wrong would refuse ordinary
  // code that has nothing to do with construction.
  expect(evaluated('class C { x: uint8 = 1;'
    + ' constructor() { function f() { return { a: 1 }; } this.x = f().a; } }'
    + ' String((new C()).x);')).toBe('1');
  expect(evaluated('class C { x: uint8 = 1;'
    + ' constructor() { const f = () => ({ a: 2 }); this.x = f().a; } }'
    + ' String((new C()).x);')).toBe('2');
  // a nested UNTYPED class may still return from its constructor
  expect(evaluated('class C { x: uint8 = 1;'
    + ' constructor() { class Inner { constructor() { return { a: 3 }; } } this.x = new Inner().a; } }'
    + ' String((new C()).x);')).toBe('3');
});

test('`return this` and bare `return` are the forms that survive', () => {
  expect(evaluated('class C { z: uint8 = 1; constructor() { return this; } } String((new C()).z);')).toBe('1');
  expect(evaluated('class C { z: uint8 = 1; constructor() { if (false) { return; } } }'
    + ' String((new C()).z);')).toBe('1');
});
