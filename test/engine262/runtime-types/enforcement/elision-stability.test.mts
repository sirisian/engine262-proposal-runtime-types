import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-check-elision, #sec-shallow-function-checks.
 *
 * A check is elided where "the value is ALREADY of the target type". That
 * premise is read off a Static Type, and a Static Type can be a lie about the
 * value that arrives when it was derived through a binding the program later
 * replaces:
 *
 *   function f(): uint32 { return 5; }
 *   function g(): uint32 { return f(); }
 *   f = function () { return 'now-a-string'; };
 *   const n: uint32 = g();
 *
 * Both checks were elided - `g`'s return, because `f()` is a `uint32`, and the
 * binding, because `g()` is - and the string reached `n` with nothing reported.
 * This is the runtime guarantee failing in FULLY ANNOTATED code, with no
 * inference involved. The assignment to `f` is admitted by the shallow function
 * check, which the specification says is the one place a violation is knowingly
 * permitted to go unreported; what the stability rule prevents is that
 * admission being compounded by an elision that assumes it never happened.
 *
 * The judgment is deliberately not "a function declaration is mutable, so never
 * elide a call": a name the source text never assigns to cannot be replaced, so
 * the ordinary call keeps its elision, and only a program that actually writes
 * to the name pays. A direct `eval` can assign to any name in scope and so
 * withdraws the judgment for the whole source text.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectThrows(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

/** The completion value of _source_, as a string. */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

test('a replaced callee cannot deliver a value the annotation refuses', () => {
  expectThrows(`function f(): uint32 { return 5; }
    function g(): uint32 { return f(); }
    f = function () { return 'now-a-string'; };
    const n: uint32 = g();`);
  // The same lie with no annotated consumer at all: the return boundary is
  // where it must be caught, since nothing downstream is obliged to look.
  expectThrows(`function f(): uint32 { return 5; }
    function g(): uint32 { return f(); }
    f = function () { return 'now-a-string'; };
    let sink = g();`);
});

test('a name the source never assigns keeps its elision', () => {
  // The ordinary case pays nothing: no assignment to `f` appears, so the call
  // through it is stable and both boundaries elide as before.
  expect(value(`function f(): uint32 { return 5; }
    function g(): uint32 { return f(); }
    const n: uint32 = g();
    \`\${n}\`;`)).toBe('5');
});

test('a const-bound callee is stable whatever the source does elsewhere', () => {
  expect(value(`const f = (): uint32 => 5;
    function g(): uint32 { return f(); }
    let other = 1; other = 2;
    const n: uint32 = g();
    \`\${n}\`;`)).toBe('5');
});

test('the boundaries the elision rule already governed are unchanged', () => {
  // A parameter-derived return still elides: a parameter is checked on entry,
  // so its type is not a claim about a replaceable binding.
  expect(value(`let reads = 0; const o = { get a() { reads += 1; return (5 := uint8); } };
    function f(s: { a: uint8 }): { a: uint8 } { reads = 0; return s; }
    f(o); \`\${reads}\`;`)).toBe('0');
  // A literal is assignable and still must be converted.
  expect(value('function f(): uint8 { return 5; } `${f() is uint8}`;')).toBe('true');
  // An ~any~ return is still checked, and still reports out of range.
  expectThrows('function anyv() { return 300; } function f(): uint8 { return anyv(); } f();');
});

test('the rule reads the whole source text, not the text before the call', () => {
  // The assignment appears AFTER the call it invalidates, which is why the
  // judgment is collected over the whole text before the walk begins.
  expectThrows(`function f(): uint32 { return 5; }
    function g(): uint32 { return f(); }
    const n: uint32 = g();
    f = function () { return 'late'; };
    g();`);
});
