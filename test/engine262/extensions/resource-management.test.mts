import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * Extension coverage - explicit resource management, the base-language feature.
 *
 * A `using` declaration binds a resource immutably and disposes it when the block
 * is left, in reverse order of acquisition, whether the block completed normally
 * or abruptly. This is the base feature the typed-resource capability was blocked
 * on, and it is deliberately partial: the synchronous form, `Symbol.dispose`, and
 * block scope are here. Not yet: `await using` and `Symbol.asyncDispose`,
 * DisposableStack and AsyncDisposableStack, SuppressedError aggregation when
 * several dispose calls throw, `using` in a for-of head, and disposal at the scope
 * of a function body or module rather than a block.
 */

test('resources: a using declaration disposes its resource when the block is left', () => {
  expect(evaluated('let log = ""; { using r = { [Symbol.dispose]() { log += "d"; } }; log += "b"; } log;')).toBe('bd');
  // the value is an ordinary binding inside the block
  expect(evaluated('let v; { using r = { x: 7, [Symbol.dispose]() { } }; v = r.x; } String(v);')).toBe('7');
});

test('resources: several resources are disposed in reverse order of acquisition', () => {
  // a resource acquired later may depend on one acquired earlier, so it goes first
  expect(evaluated('let log = ""; { using a = { [Symbol.dispose]() { log += "a"; } }; using b = { [Symbol.dispose]() { log += "b"; } }; } log;')).toBe('ba');
});

test('resources: a resource is disposed when the block is left abruptly', () => {
  expect(evaluated('let log = ""; try { { using r = { [Symbol.dispose]() { log += "d"; } }; throw new Error("x"); } } catch { } log;')).toBe('d');
  // and an error raised by disposal itself reaches the program
  expect(evaluated('let c = "no"; try { { using r = { [Symbol.dispose]() { throw new Error("boom"); } }; } } catch { c = "caught"; } c;')).toBe('caught');
});

test('resources: null and undefined are permitted, anything undisposable is not', () => {
  // this is what lets a program write `using handle = mayBeNothing()`
  expect(evaluated('{ using r = null; } "ok";')).toBe('ok');
  expect(evaluated('{ using r = undefined; } "ok";')).toBe('ok');
  // an object with no dispose method cannot keep the declaration's promise
  expectThrown('{ using r = {}; } "ok";');
  expectThrown('{ using r = 5; } "ok";');
});

test('resources: a using binding is immutable', () => {
  // rebinding would lose the thing to dispose
  expectThrown('{ using r = { [Symbol.dispose]() { } }; r = 1; } "ok";');
});

test('resources: using remains an ordinary identifier where no declaration follows', () => {
  // `using` is contextual: it opens a declaration only before an identifier on the
  // same line, so existing programs that use the name are unaffected
  expect(evaluated('let using = 5; String(using);')).toBe('5');
  expect(evaluated('let using = 5; String(using + 1);')).toBe('6');
  expect(evaluated('let using = 1; using\n+ 2; "ok";')).toBe('ok');
});

test('resources: with the feature off the engine is the base engine', () => {
  // a using declaration is a Syntax Error, and `using` is just a name
  expect((runFlagOff('{ using r = { [Symbol.dispose]() { } }; } "ok";') as { Type: string }).Type).toBe('throw');
  expect((runFlagOff('let using = 5; String(using);') as { Type: string }).Type).toBe('normal');
});
