import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-array-types, #sec-tuple-types, #sec-conversions,
 * #sec-inference-fixpoint (r19).
 *
 * An array literal has no Static Type today. That is why r19 - the rule that
 * reports a return type which grows at every step of the fixpoint - is
 * implemented and unreachable: the shape the specification gives for it,
 * `function w(a: uint32) { return [w(a)]; }`, cannot grow when `[w(a)]` is
 * ~any~.
 *
 * This file pins three things so that the boundary between "not implemented"
 * and "not intended" is written down rather than rediscovered:
 *
 *   - what an ANNOTATION already makes work, which must not regress;
 *   - what a bare literal does today, marked `test.fails` where the plan says
 *     it should change;
 *   - what is deliberately unchanged, because a binding without an annotation
 *     has the ~any~ Static Type whatever its initializer.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectOk(source: string) {
  expect(run(source)).toMatchObject({ Type: 'normal' });
}

function expectThrows(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

/** The message of the error _source_ produces. */
function thrown(source: string): string {
  const completion = run(source) as unknown as {
    Type: string, Value: { properties?: Map<{ stringValue?(): string }, { Value?: { stringValue?(): string } }> },
  };
  if (completion.Type !== 'throw') {
    throw new Error('expected a throw completion');
  }
  for (const [k, v] of completion.Value.properties ?? []) {
    if (k.stringValue?.() === 'message') {
      return v.Value?.stringValue?.() ?? '';
    }
  }
  return '';
}

/** The completion value of _source_, as a string. */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

test('an annotation supplies the element type', () => {
  // These work today and are the regression guard for everything below: typing
  // the literal must not disturb the contextual path that already types it.
  expect(value('let a: [].<uint8> = [1, 2]; String(a[0] is uint8);')).toBe('true');
  expect(value('let t: [uint8, uint32] = [1, 2]; String(t[0] is uint8);')).toBe('true');
  expect(value('let a: [].<uint8> = [1]; let b: [].<uint8> = [...a]; String(b[0] is uint8);')).toBe('true');
  expect(value('let a: [].<[].<uint8>> = [[1]]; String(a[0][0] is uint8);')).toBe('true');
  // An element the annotation cannot hold is refused before the program runs.
  expectThrows('let a: [].<uint8> = [300];');
});

test('a parameter and a tuple return convert their literal', () => {
  expect(value('function g(a: [].<uint8>) { return String(a[0] is uint8); } g([1]);')).toBe('true');
  expect(value('function f(): [uint8, uint32] { return [1, 2]; } String(f()[0] is uint8);')).toBe('true');
  expect(value('let a: [].<uint8> = [1]; function f(): [].<uint8> { return a; } String(f()[0] is uint8);')).toBe('true');
});

test('a declared ARRAY return converts its literal', () => {
  // The one boundary that does not, and only for a DIRECT literal: staticTypeIn
  // has an arm that reports the TARGET type for an array literal at an
  // array-typed position, which is what checks the elements and is also what
  // makes the return annotation elidable - so the conversion that would build
  // an Array carrying the element type never runs.
  expect(value('function f(): [].<uint8> { return [1, 2]; } String(f()[0] is uint8);')).toBe('true');
});

test('every neighbouring spelling already converts', () => {
  // Which is what tells the case above apart from a missing conversion, and
  // what makes parentheses a workaround: a parenthesized literal is not an
  // ArrayLiteral at that position, so it never reaches the arm.
  expect(value('function f(): [].<uint8> { return ([1]); } String(f()[0] is uint8);')).toBe('true');
  expect(value('function f(): [].<uint8> { let t = [1]; return t; } String(f()[0] is uint8);')).toBe('true');
  expect(value('function f(): [uint8] { return [1]; } String(f()[0] is uint8);')).toBe('true');
  expect(value('function anyv() { return [1]; } function f(): [].<uint8> { return anyv(); } String(f()[0] is uint8);')).toBe('true');
});

test('an array type is invariant in its element type', () => {
  // Why a bare literal's join type is useful for reading and for contributing
  // to an inference, and useless as a source at an annotated position - and why
  // an empty literal must NOT report `[].<never>`.
  expectThrows('let n: [].<number> = [1]; let u: [].<uint8> = n;');
  expectThrows('let u: [].<uint8> = [1]; let n: [].<number> = u;');
  expectThrows('let e: [].<never> = []; let u: [].<uint8> = e;');
  // The family's top admits them, which is the one exception the clause makes.
  expectOk('let u: [].<uint8> = [1]; let t: [].<any> = u;');
  // And an empty literal at an annotation works today, which typing it must not
  // disturb.
  expectOk('let u: [].<uint8> = [];');
});

test('the return check itself does run', () => {
  // Which is what tells the case above apart from a missing check.
  expectThrows('function f(): [].<uint8> { return [300]; }');
});

test('a bare literal has the type of its elements joined', () => {
  // #sec-array-types. Written where no array type reaches it, a literal is an
  // array of the widened join of its elements.
  expectThrows('const s: string = [1, 2];');          // [].<number>
  expectThrows('const s: string = [1, 2][0];');       // read: number
  expectThrows('const s: string = [1, "x"];');        // [].<number | string>
  // An unknown element leaves the element type unknown rather than stating the
  // join of the others - so the mistake below is the boundary's to catch at run
  // time rather than the checker's, and the message names the VALUE.
  expect(thrown('function anyv() { return 1; } const s: string = [1, anyv()];')).toContain('[object Array]');
  // An empty literal says nothing about its elements, so it still fits any
  // array annotation - reporting `[].<never>` would say something false, since
  // element types are invariant.
  expectOk('let u: [].<uint8> = [];');
  // An empty literal reports nothing, so the boundary decides and names the
  // VALUE rather than a type.
  expect(thrown('const s: string = [];')).toContain('[object Array]');
});

test('an array literal contributes to an inferred return', () => {
  // An ~any~ contribution poisons a join, so a function returning an array
  // literal publishes nothing however completely its signature is annotated.
  expect(thrown('function f(): uint8 { return 1; } function g(a: uint32) { return [f()]; } const s: string = g(1);'))
    .toContain('[].<uint.<8>>');
  expect(thrown('function g(a: uint32) { return [1]; } const s: string = g(1);')).toContain('[].<number>');
});

test('a return type that grows at every step is reported (r19)', () => {
  // The rule is implemented; this is the shape that reaches it, and it cannot
  // grow until an array literal has a type. The annotated form beside it is the
  // remedy the diagnostic names.
  expect(thrown('function w(a: uint32) { return [w(a)]; }')).toContain('grows at every step');
});

test('the annotated remedy for a growing return is accepted', () => {
  expectOk('function w(a: uint32): [].<any> { return [w(a)]; }');
});

test('a bare literal in an unannotated binding stays untyped, by design', () => {
  // NOT a gap. A binding without an annotation has the ~any~ Static Type
  // whatever its initializer, so typing the literal does not reach `a` and the
  // mistake below is still the boundary's to catch. `:=` or an annotation is
  // what carries a type across.
  expectThrows('const a = [1]; const s: string = a;');
  expectThrows('const a = []; const s: string = a;');
  expectThrows('const a = [1, "x"]; const s: string = a;');
  // Including a read THROUGH such a binding: the literal has a type, and the
  // binding does not carry it. `:=` or an annotation is what does.
  expectOk('const a = [1, 2]; const s: string = a[0];');
});

test('an untyped program mostly keeps its meaning', () => {
  // The reason a bare array literal must not simply acquire a type. With one,
  // `[1n]` is a `[].<bigint>`, `includes` is read at that element type, and
  // literal propagation builds the argument `1` as `1n` - so this program,
  // which has no annotation anywhere, changes from false to true. Every step is
  // the proposal working as specified; the result is still inadmissible.
  // Accepted change: `[1n]` is a `[].<bigint>`, so `includes` takes a `bigint`
  // and literal propagation builds `1` as `1n`. Nothing writes this expecting
  // *false*, and leaving every array literal untyped to preserve it costs more
  // than it saves.
  expect(value('String([1n].includes(1));')).toBe('true');
  expect(value('String([1].includes(1));')).toBe('true');
});
