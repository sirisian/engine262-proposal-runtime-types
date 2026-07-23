import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * Extension coverage - explicit resource management, the base-language feature.
 *
 * A `using` declaration binds a resource immutably and disposes it when the block
 * is left, in reverse order of acquisition, whether the block completed normally
 * or abruptly. This is the base feature the typed-resource capability was blocked
 * on, and it is deliberately partial: the synchronous form, `Symbol.dispose`, and
 * block scope are here, together with the type-system slice: a resource binding
 * takes the same annotations a `const` does, and a declared type whose values could
 * never carry a disposal method is a compile-time error. Not yet: `await using` and
 * `Symbol.asyncDispose`, DisposableStack and AsyncDisposableStack, SuppressedError
 * aggregation when several dispose calls throw, `using` in a for-of head, and
 * disposal at the scope of a function body or module rather than a block.
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

// -- The type system slice: annotations on a resource binding ------------------
test('resources: a resource binding takes the same annotations a const does', () => {
  // the annotation is threaded onto the binding and applies at the boundary, as it
  // does for any other declaration
  expect(evaluated('{ using r: object = { x: 7, [Symbol.dispose]() { } }; String(r.x); } "ok";')).toBe('ok');
  expect(evaluated('class F { [Symbol.dispose]() { } } { using r: F = new F(); } "ok";')).toBe('ok');
  // and the resource still has to be disposable at run time whatever the annotation
  expectThrown('{ using r: object = {}; } "ok";');
});

test('resources: a declared type that could carry no disposal method is rejected', () => {
  // the declaration promises to dispose what it binds, so a type whose values can
  // never carry a disposal method is a mistake, caught before the program runs
  expectThrown('{ using r: string = "x"; } "ok";');
  expectThrown('{ using r: uint8 = (5 := uint8); } "ok";');
  expectThrown('{ using r: number = 5; } "ok";');
  expectThrown('{ using r: boolean = true; } "ok";');
  expectThrown('{ using r: void = undefined; } "ok";');
});

test('resources: a type that can be disposed is accepted', () => {
  expect(evaluated('{ using r: object = { [Symbol.dispose]() { } }; } "ok";')).toBe('ok');
  expect(evaluated('{ using r: any = { [Symbol.dispose]() { } }; } "ok";')).toBe('ok');
  // null and undefined are admitted, since the declaration permits them at run
  // time and registers nothing
  expect(evaluated('{ using r: null = null; } "ok";')).toBe('ok');
  expect(evaluated('{ using r: object | null = null; } "ok";')).toBe('ok');
  // an unannotated resource is unaffected
  expect(evaluated('{ using r = { [Symbol.dispose]() { } }; } "ok";')).toBe('ok');
});

test('resources: the rule applies to using declarations only', () => {
  // let and const take the same annotations and are not resource declarations
  expect(evaluated('let x: string = "x"; x;')).toBe('x');
  expect(evaluated('const y: uint8 = (5 := uint8); String(Number(y));')).toBe('5');
});
