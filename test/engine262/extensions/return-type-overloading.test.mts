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
