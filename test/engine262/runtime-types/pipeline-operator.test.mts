import { test, expect } from 'vitest';
import {
  evaluated, ok, expectError, expectErrorFlagOff, evaluatedFlagOff,
} from './harness.mts';

/**
 * PLAN-pipeline-operator.md phases 1 and 2, per #sec-pipeline-operator.
 *
 * `x |> f(%)` binds the left operand to the topic and evaluates the right with
 * that binding in scope. The topic is a BINDING rather than a substitution, and
 * most of these tests exist to pin the consequences of that: the left operand
 * is evaluated once, an inner pipeline shadows an outer one, a closure inside a
 * step still sees the topic, and a test on the topic narrows it.
 */

test('the value, and the topic in the positions an expression goes', () => {
  expect(evaluated('String(5 |> % + 1);')).toBe('6');
  expect(evaluated('function f(x) { return x * 2; } function g(x) { return x + 1; } String(5 |> f(%) |> g(%));')).toBe('11');
  expect(evaluated('String([1, 2, 3] |> %.length);')).toBe('3');
  expect(evaluated("String('a' |> `${%}${%}`);")).toBe('aa');
  expect(evaluated('String((5 |> [%, %]).join(","));')).toBe('5,5');
  expect(evaluated('function f(a, b) { return a + b; } String(5 |> f(1, %));')).toBe('6');
});

test('the left operand is evaluated once, however many times the topic appears', () => {
  // The difference between a binding and a substitution, and the reason the
  // runtime uses an environment rather than rewriting the body.
  expect(evaluated(`
    let n = 0;
    const e = () => { n += 1; return 5; };
    e() |> [%, %];
    String(n);
  `)).toBe('1');
});

test('an inner pipeline shadows an outer one', () => {
  expect(evaluated('function f(a, b) { return a + b; } String(1 |> f(%, 2 |> % * 10));')).toBe('21');
  expect(evaluated("String('ab' |> (1 |> % + 1) + %.length);")).toBe('4');
});

test('a closure inside a step still sees the topic', () => {
  // The arrow runs with its own function environment installed, whose outer is
  // the topic environment, so the lookup has to walk the chain. Reading the
  // immediate environment fails here as an assertion rather than an error.
  expect(evaluated('String(([1, 2] |> %.map((v) => v + %.length)).join(","));')).toBe('3,4');
});

test('every step must use the topic', () => {
  expectError('function f() { return 1; } 5 |> f();');
  expectError('5 |> 1;');
  // A topic belonging to a NESTED pipeline is not the outer body's.
  expectError('function f(x) { return x; } function g(x) { return x; } 1 |> f(2 |> g(%));');
  // Which the outer body having its own makes legal.
  expect(evaluated('function f(a, b) { return a + b; } function g(x) { return x; } String(1 |> f(%, 2 |> g(%)));')).toBe('3');
});

test('the topic is meaningless outside a pipeline body', () => {
  expectError('const x = %;');
  expectError('function f(x) { return x; } f(%);');
});

test('precedence: looser than a range, tighter than a conditional', () => {
  // The order the specification states in both clauses, because ranges occupy
  // the level the upstream proposal named for the pipeline's operands.
  expect(evaluated('String(0..<10 |> %.start);')).toBe('0');
  expect(evaluated('function f(x) { return x; } String(true ? 1 |> f(%) : 2);')).toBe('1');
  expect(evaluated('function f(x) { return x; } String(null ?? 3 |> f(%));')).toBe('3');
});

test('the remainder operator is untouched', () => {
  // The topic shares a token with an operator that appears in every program.
  expect(evaluated('String(7 % 4);')).toBe('3');
  expect(evaluated('String(7 % 4 |> % + 1);')).toBe('4');
  expect(evaluatedFlagOff('String(7 % 4);')).toBe('3');
});

test('the topic carries a type, and the pipeline has the body\'s', () => {
  expect(ok('const d: number = 3 |> %;')).toBe(true);
  expect(ok('const d: string = 3 |> %;')).toBe(false);
  expect(ok("const a: number = 'x' |> %.length;")).toBe(true);
});

test('a contextual type reaches through the pipe', () => {
  expect(ok(`
    function clamp(v: uint8, lo: uint8, hi: uint8): uint8 { return v; }
    const c: uint8 = 3 |> clamp(%, 0, 10);
  `)).toBe(true);
});

test('a test on the topic narrows it', () => {
  // The topic is bound under a name no program can write, so every row of the
  // narrowing table reaches it with no new machinery.
  expect(ok(`
    function f(x: string | uint8): number { return x |> (typeof % === 'string' ? %.length : %); }
  `)).toBe(true);
  expect(ok(`
    class Shape {}
    class Circle extends Shape { radius: uint8 = 1; }
    function g(s: Shape): uint8 { return s |> (% is Circle ? %.radius : 0); }
  `)).toBe(true);
});

test('composes with match and do', () => {
  expect(evaluated("String(1 |> match (%) { when 1: 'one'; default: 'other'; });")).toBe('one');
  expect(evaluated('String(3 |> do { const t = % * 2; t + 1 });')).toBe('7');
});

test('the base language is untouched with the feature off', () => {
  expectErrorFlagOff('const x = 5 |> % + 1;');
  expect(evaluatedFlagOff('String(5 | 2);')).toBe('7');
});

test('the topic is immutable', () => {
  expectError('5 |> (% = 1);');
  expectError('5 |> %++;');
});

test('the topic is a value, not a place', () => {
  // A reference parameter binds the caller's LOCATION; the topic holds the
  // value the left operand produced, so a reference through it would bind a
  // temporary and the write would reach nothing observable.
  expectError('function inc(ref a: int32) { a++; } let n: int32 = 0; n |> inc(ref %);');
  // The same call written without the pipe is the one that works, and is
  // shorter — which is why the refusal costs nothing.
  expect(evaluated('function inc(ref a: int32) { a++; } let n: int32 = 0; inc(ref n); String(n);')).toBe('1');
});

test('await and yield in a step are the enclosing function\'s', () => {
  expect(evaluated(`
    async function f() { return 1 |> Promise.resolve(%) |> await % |> % + 1; }
    String(typeof f().then);
  `)).toBe('function');
  expect(evaluated('function* g() { 1 |> (yield %); } String([...g()].join(","));')).toBe('1');
});

test('the topic goes where any expression goes', () => {
  expect(evaluated('function f(...xs) { return xs.length; } String([1, 2, 3] |> f(...%));')).toBe('3');
  expect(evaluated('function f(a, b, c) { return a + b + c; } String(2 |> f(1, %, 3));')).toBe('6');
  expect(evaluated('String(({ v: 1 } |> %.v));')).toBe('1');
});

/**
 * Two corpus items from PLAN-pipeline-operator.md §5.5 are not testable here,
 * and the reason is not the pipeline. Overload declarations
 * (`function f(v: uint32): string;`) and generic function declarations
 * (`function id.<T>(v: T): T`) are not parsed by this engine at all — both fail
 * identically without a pipe. The pipeline's part of each rule, that resolution
 * and inference read the topic's type like any argument's, is specified in
 * #sec-pipeline-static-semantics and will be testable when the declarations are.
 */

test('the topic is refused in every binding position, not just assignment', () => {
  // Each of these is caught by the base grammar rather than by a rule of this
  // extension — a TopicReference is not a valid assignment target — but the
  // plan lists them, so they are asserted rather than assumed.
  expectError('5 |> ([%] = [1]);');
  expectError('5 |> ({ a: % } = { a: 1 });');
  expectError('[1] |> (function () { for (% of [1]) {} })();');
});

test('|> may not be declared as an operator, while % may', () => {
  // The contrast is what makes this worth pinning. `%` is an ordinary binary
  // operator a class may give a meaning to; `|>` is not an operation at all —
  // it binds one operand and evaluates the other, so resolution has nothing to
  // search the left operand's type for.
  expectError('class V { operator |>(o: V): V { return o; } }');
  expect(ok('class V { operator %(o: V): V { return o; } }')).toBe(true);
});
