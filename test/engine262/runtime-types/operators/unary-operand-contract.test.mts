import { expect, test } from 'vitest';
import { evaluated, evaluatedFlagOff, expectStaticTypeError, expectThrownKind } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, Get, Value, X, type ObjectValue } from '#self';

/**
 * Spec: #sec-unary-operators-for-typed-values. "It is a type error to apply
 * unary `+` to an operand whose participating Static Type establishes only
 * BigInt or Symbol values, or unary `-` or `~` to one establishing only Symbol
 * values." Participation is "an operand contract": an annotation, a declared
 * member, a declared return, or a contract carried through a constant.
 *
 * Untyped code keeps its run-time timing: "`+1n`, `+Symbol()`, `+BigInt(1)`, and
 * aliases or patterns derived solely from those untyped values retain their
 * runtime exception timing", and "an ordinary unannotated mutable binding does
 * not acquire a permanent contract from its initializer". The engine refused
 * some of that untyped code before it ran - an early pass knew `const k = 5n` was
 * a `bigint` and took the type for a contract - so a plain JavaScript script
 * that caught its own error was refused outright once the proposal was enabled.
 */

/** The message of a static error, for the cases whose wording is tested. */
function staticMessage(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const c = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
  expect(c.Type, `expected a static error for: ${source}`).toBe('throw');
  const pop = realm.pushTopContext();
  try {
    return (X(Get(c.Value as ObjectValue, Value('message'))) as { stringValue(): string }).stringValue();
  } finally {
    pop?.();
  }
}

test('an operand that is a BigInt or Symbol by contract is refused before the program runs', () => {
  for (const src of [
    'function f(b: bigint) { return +b; }',
    'let b: bigint = 5n; +b;',
    'function g(): bigint { return 5n; } +g();',
    'const o: { x: bigint } = { x: 5n }; +o.x;',
    'let b: bigint = 5n; const c = b; +c;', // a constant carries the contract
    'function f(s: symbol) { return +s; }',
    'function f(s: symbol) { return -s; }',
    'function f(s: symbol) { return ~s; }',
    'function f(x: bigint | symbol) { return +x; }', // every alternative forbidden
  ]) {
    expectStaticTypeError(src);
  }
});

test('the refusal names the operator and the type', () => {
  expect(staticMessage('function f(b: bigint) { return +b; }')).toContain('unary "+" cannot be applied to a value of type "bigint"');
  expect(staticMessage('function f(s: symbol) { return ~s; }')).toContain('unary "~" cannot be applied to a value of type "symbol"');
});

test('untyped code keeps its run-time timing', () => {
  // Each was refused before the program ran; each now throws only when run.
  for (const body of [
    'let v = 5n; return +v;', 'const k = 5n; return +k;', 'let [a] = [5n]; return +a;',
    'let s = Symbol(); return +s;', 'const t = Symbol(); return -t;',
    'return +5n;', 'return +Symbol();', 'return +BigInt(1);', 'var v = 5n; return +v;',
    'const k = 5n * 2n; return +k;', 'let v: any = 5n; return +v;',
  ]) {
    expect(evaluated(`function f() { ${body} } 'loaded';`)).toBe('loaded');
    expectThrownKind(`(function () { ${body} })();`, 'TypeError');
  }
  // A union with an allowed alternative keeps the run-time check.
  expectThrownKind('function f(x: bigint | number) { return +x; } f(5n);', 'TypeError');
});

test('an untyped script that handles its own error runs as it does without the proposal', () => {
  const src = "function f() { let v = 5n; try { return +v; } catch (e) { return 'caught'; } } f();";
  expect(evaluated(src)).toBe('caught');
  expect(evaluatedFlagOff(src)).toBe('caught');
});

test('the top level and a function body agree', () => {
  expectThrownKind('let v = 5n; +v;', 'TypeError');
  expectThrownKind('(function () { let v = 5n; return +v; })();', 'TypeError');
});

test('a BigInt still admits unary minus and bitwise NOT', () => {
  expect(evaluated('function f(b: bigint) { return -b; } String(f(5n));')).toBe('-5');
  expect(evaluated('function f(b: bigint) { return ~b; } String(f(5n));')).toBe('-6');
});
