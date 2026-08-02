import { test, expect } from 'vitest';
import { ok, evaluated } from '../readme/harness.mts';

/**
 * PLAN-return-type-overloading.md phase 1: the filter.
 *
 * #sec-overloading-on-return-type: "a signature is identified by its return
 * type as well as its parameter types. The return type does not participate in
 * ranking; it participates in filtering" - and where a call has no contextual
 * type and more than one signature remains viable, the call is ambiguous.
 *
 * The signature record carries its return type now, and the resolver filters
 * the TIED candidates by it when given a contextual type.
 *
 * PHASE 2 IS DONE. `const a: string = f()` selects the string signature and
 * `const b: uint32 = f()` selects the other, which is the clause's own example.
 * A bare `f()` remains a type error, which is the clause's ambiguity rule.
 *
 * Four defects were fixed reaching it, and the last one is the reason the
 * others were not enough on their own:
 *
 *   - The checker DROPPED `Return` when mapping its signatures into resolver
 *     candidates. Its signatures carry one; the mapping did not copy it.
 *   - The contextual type had no route from staticTypeIn, which knows it, to
 *     the walk that resolves, which does not. It is recorded on the call node
 *     by the first and read by the second.
 *   - OverloadSignatureOf looked its return type up in a map keyed on the
 *     FORMALS, where a return annotation never appears.
 *   - And then it read `fn.TypeAnnotation`, which is empty: the annotation is
 *     on the function's PARSE NODE, not on the function object. The codebase
 *     already had returnAnnotationOf, which reaches it through
 *     ECMAScriptCode.parent, and using it was the whole fix.
 *
 * The last is worth keeping because two earlier attempts at the same field both
 * failed on where the annotation lives rather than on any rule - and the
 * accessor for it existed the whole time, twenty lines above the code that
 * needed it.
 */

test('overloading on parameters resolves', () => {
  // The part that already worked, asserted here because the filter must not
  // disturb it: this is decided by RANKING and never reaches the tie-break.
  const P = 'function f(a: uint8) { return 1; } function f(a: string) { return 2; } ';
  expect(evaluated(`${P}String(f("x"));`)).toBe('2');
  expect(evaluated(`${P}String(f(1));`)).toBe('1');
});

test('two signatures differing only in return are declared', () => {
  // They parse and both are registered - the design writes two full bodies
  // rather than TypeScript-style declarations, which is what an earlier
  // measurement of this feature got wrong.
  expect(ok('function f(): uint32 { return 10; } function f(): string { return "10"; }')).toBe(true);
});

test('a call with no contextual type is ambiguous', () => {
  // The clause's own example, and the half that is already correct.
  const P = 'function f(): uint32 { return 10; } function f(): string { return "10"; } ';
  expect(ok(`${P}f();`)).toBe(false);
});

test('a call in a binding position selects by its contextual type', () => {
  // #sec-overloading-on-return-type's own example. The bodies return different
  // VALUES rather than different spellings of one, so the assertion says which
  // signature ran rather than only that something did.
  const P = 'function f(): uint32 { return 1; } function f(): string { return "two"; } ';
  expect(evaluated(`${P}const a: string = f(); String(a);`)).toBe('two');
  expect(evaluated(`${P}const b: uint32 = f(); String(b);`)).toBe('1');
});

test('the filter runs after ranking, not before', () => {
  // The clause: "the return type does not participate in ranking; it
  // participates in filtering". A signature beaten on RANK must stay beaten
  // however well its return type matches - so the uint8 row wins on rank and
  // the contextual type cannot promote the any row over it.
  const P = 'function h(a: uint8): uint32 { return 1; } function h(a: any): string { return "two"; } ';
  expect(evaluated(`${P}const s: uint32 = h(1); String(s);`)).toBe('1');
  // And the same call in a STRING context still runs the uint8 row - the value
  // is 1, not "two". Ranking already chose, so there is no tie for the filter
  // to break and the contextual type cannot promote the worse-ranked signature.
  // This is the assertion that fails if the filter is ever moved before
  // ranking, and it is the reason it is written as a value rather than as an
  // acceptance: the assignment succeeds either way, and only the value says
  // which body ran.
  expect(evaluated(`${P}const t: string = h(1); String(t);`)).toBe('1');
});

test('an untyped catch-all still ranks last', () => {
  // #sec-overload-resolution's own example. The filter runs only on a tie, so
  // a catch-all beaten on rank never reaches it.
  const P = 'function f() { return 0; } function f(a: uint8) { return 1; } ';
  expect(evaluated(`${P}String(f(1));`)).toBe('1');
  expect(evaluated(`${P}String(f(1, 2));`)).toBe('0');
});

/**
 * PHASE 3, THE ARGUMENT POSITION: attempted, reverted, and the obstacle is
 * generic inference rather than the contextual type.
 *
 * The clause specifies both cases: "`g(f())` selects the first where `g` takes
 * a `uint32`, because the parameter supplies the contextual type. `h(f())` is
 * an error where `h` is itself overloaded ... The circularity is real and is
 * resolved by rejecting the call rather than by guessing."
 *
 * IT WORKED. Pushing the sole signature's parameter type around argument
 * evaluation in EvaluateCall made `g(f())` select `1` for a `uint32` parameter
 * and `"two"` for a `string` one, and left `h(f())` refused - all three of the
 * clause's cases, including the circularity resolving by NOT pushing where the
 * callee is overloaded.
 *
 * AND IT BROKE TEN GENERIC-INFERENCE TESTS. `capability-b-inference` covers a
 * generic call whose parameter is an unconstrained type parameter, and pushing
 * that parameter as a contextual type changes what the inference sees. The
 * contextual type is currently pushed only at an annotated binding; making it
 * the common case at every argument of every call is exactly the
 * broad-blast-radius change this file's own phase-2 note warned about.
 *
 * `soleSignatureParameterTypes` is kept - it is correct, tested by hand against
 * all three clause cases, and answers null for an overloaded callee, which is
 * the circularity rule. What it needs is a caller that pushes only where the
 * parameter is a concrete type rather than a type parameter, so inference is
 * untouched. That is the next step and it is a condition on one call, not a
 * redesign.
 */

test('an argument position supplies a contextual type', () => {
  // #sec-overloading-on-return-type: "`g(f())` selects the first where `g`
  // takes a `uint32`, because the parameter supplies the contextual type."
  const F = 'function f(): uint32 { return 1; } function f(): string { return "two"; } ';
  expect(evaluated(`${F}function g(x: uint32) { return x; } String(g(f()));`)).toBe('1');
  expect(evaluated(`${F}function g(x: string) { return x; } String(g(f()));`)).toBe('two');

  // "`h(f())` is an error where `h` is itself overloaded ... The circularity is
  // real and is resolved by rejecting the call rather than by guessing." This
  // was right by accident before the argument position worked; now it is right
  // because soleSignatureParameterTypes answers null for an overloaded callee,
  // and the assertion is what keeps the fix for the case above from breaking it.
  expect(ok(`${F}function h(x: uint8) { return 1; } function h(x: string) { return 2; } h(f());`)).toBe(false);
});

test('a generic call is untouched by the argument context', () => {
  // The regression the first two attempts caused, asserted so a third cannot
  // reintroduce it. A generic parameter's annotation names a type that is not
  // bound until the call binds it, so resolving it here fails - and that
  // failure must not escape, since this is offering a contextual type rather
  // than checking anything.
  expect(evaluated('function id<T>(x: T): T { return x; } String(id("hi"));')).toBe('hi');
  expect(evaluated('function id<T>(x: T): T { return x; } String(Reflect.typeOf(id("hi")) === string);')).toBe('true');
});

/**
 * The return position, which the clause's general rule covers without listing
 * among its worked examples: "the contextual type of a call is the type its
 * position requires", and a `return` in an annotated function is such a
 * position - EnforceReturnType enforces exactly that requirement.
 *
 * The annotation is pushed around the BODY rather than applied to its result.
 * Applied to a result it cannot select an overload, because the overload has
 * already run - which is what the binding boundary looked like before phase 2.
 */

test('a return position supplies a contextual type', () => {
  const F = 'function f(): uint32 { return 1; } function f(): string { return "two"; } ';
  expect(evaluated(`${F}function r(): string { return f(); } String(r());`)).toBe('two');
  expect(evaluated(`${F}function r(): uint32 { return f(); } String(r());`)).toBe('1');
  // A block-bodied arrow is the same path and selects too.
  expect(evaluated(`${F}const r = (): string => { return f(); }; String(r());`)).toBe('two');
});

test('a generic function body is untouched', () => {
  // The regression guard: a generic function's return annotation names a type
  // parameter that is not bound yet, so it contributes no contextual type
  // rather than failing.
  expect(evaluated('function id<T>(x: T): T { return x; } String(id("hi"));')).toBe('hi');
  expect(evaluated('function id<T>(x: T): T { return x; } String(Reflect.typeOf(id("hi")) === string);')).toBe('true');
});

/**
 * A CONCISE ARROW BODY IS A THIRD SITE AND IS NOT DONE.
 *
 * `const r = (): string => f();` still reports the inner call's ambiguity,
 * while `(): string => { return f(); }` selects. So the expression-bodied arrow
 * evaluates its body somewhere other than the two sites this commit brackets -
 * a narrower gap than the one just closed, and the same shape again.
 */

test('a concise arrow body does not yet supply a contextual type', () => {
  const F = 'function f(): uint32 { return 1; } function f(): string { return "two"; } ';
  expect(ok(`${F}const r = (): string => f(); r();`)).toBe(false);
});
