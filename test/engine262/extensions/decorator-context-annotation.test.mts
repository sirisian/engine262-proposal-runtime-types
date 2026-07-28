import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../readme/harness.mts';

/**
 * The kind a rejection carries, through `eval` so that an EARLY error is
 * catchable and its kind assertable - the harness's `expectThrownKind` cannot
 * reach one, because the script carrying its try/catch never runs.
 */
function rejectionKind(source: string): string {
  return evaluated(`try { eval(${JSON.stringify(source)}); "NO-THROW"; } catch (e) { e.constructor.name; }`);
}

/**
 * proposal-runtime-types #sec-decorator-application: "A decorator is an
 * ordinary function whose LAST PARAMETER IS ANNOTATED WITH A REFLECTION
 * CONTEXT."
 *
 * That form threw. Annotating a decorator's parameter with its context - the
 * form the clause defines, the form every example in decorators.md is written
 * in, and the form the clause's own dispatch rule reads to select among
 * declarations - failed with a ReferenceError as soon as the decorator ran. So
 * only an UNTYPED parameter worked, which is why every decorator test written
 * for stages A-G is written that way.
 *
 * THE CAUSE was one branch reached in the wrong order. A reflection context is
 * a ~nominal~ type carrying a [[LibraryName]], and the library branch of
 * IsOfType resolves a [[LibraryName]] as a GLOBAL BINDING - which is right for
 * `Map` and `Error`, whose values are instances of a global constructor, and a
 * ReferenceError for `Reflect.ClassField`, whose name is dotted and names no
 * binding at all. The contexts had resolved as values and as type ARGUMENTS
 * for four cycles; type-annotation position was the one that reached this.
 */

test('a decorator parameter annotated with its context works, at every family', () => {
  // The form the specification defines, at one context per family.
  expect(evaluated('let k = "never"; function f(c: Reflect.ClassField) { k = String(c.name); } class A { @f a: uint8; } k;')).toBe('a');
  expect(evaluated('let k = "never"; function f(c: Reflect.Class) { k = String(c.name); } @f class Named {} k;')).toBe('Named');
  expect(evaluated('let k = "never"; function f(c: Reflect.ClassMethod) { k = String(c.name); } class A { @f m() {} } k;')).toBe('m');
  expect(evaluated('let k = "never"; function f(c: Reflect.ClassMethodParameter) { k = String(c.index); } class A { m(@f p: uint8) {} } k;')).toBe('0');
  expect(evaluated('let k = "never"; function f(c: Reflect.Function) { k = String(c.name); } @f function fn() {} k;')).toBe('fn');
  expect(evaluated('let k = "never"; function f(c: Reflect.Let) { k = String(c.name); } @f let x = 1; k;')).toBe('x');
  expect(evaluated('let k = "never"; function f(c: Reflect.ObjectField) { k = String(c.name); } const o = { @f a: 1 }; k;')).toBe('a');
  expect(evaluated('let k = "never"; function f(c: Reflect.Enum) { k = String(c.name); } @f enum E { A } k;')).toBe('E');
  expect(evaluated('let k = "never"; function f(c: Reflect.Block) { k = c.kind; } @f { let a = 1; } k;')).toBe('Block');
});

test('the WRONG context is refused, and by the kind that says why', () => {
  // This is §6.1's third assertion arriving: "a decorator that fires with the
  // wrong context still fires", so the assertion that matters is that the
  // wrong one is REFUSED. Before this it was refused too - with a
  // ReferenceError naming the context as an undefined binding, which reports a
  // missing global where the fact is a value of the wrong type.
  expectThrownKind('function f(c: Reflect.Class) {} class A { @f a: uint8; }', 'TypeError');
  expectThrownKind('function f(c: Reflect.ClassField) {} @f class A {}', 'TypeError');
  expectThrownKind('function f(c: Reflect.ClassGetter) {} class A { @f m() {} }', 'TypeError');
  // A sub-target's context is not its owner's.
  expectThrownKind('function f(c: Reflect.ClassMethod) {} class A { m(@f p: uint8) {} }', 'TypeError');
});

test('a reflection context is a STRUCTURAL type, as the design writes it', () => {
  // decorators.md writes every context as an object shape - `type
  // ClassFieldReflection = { ... }`, with `Reflect.ClassField` an interface
  // extending it - so membership reads the value's own discriminant rather
  // than a brand. `kind` is what every reflection object this engine builds
  // sets, and it is what the tests of stages A-G already read.
  expect(evaluated('let r = "?"; function f(c) { r = String(c is Reflect.ClassField); } class A { @f a: uint8; } r;')).toBe('true');
  expect(evaluated('let r = "?"; function f(c) { r = String(c is Reflect.Class); } class A { @f a: uint8; } r;')).toBe('false');
  // An object of the wrong shape is not of the type, so the judgment is doing
  // work rather than admitting any object.
  expectThrownKind('let x: Reflect.ClassField = { kind: "nope" };', 'TypeError');
  expectThrownKind('let x: Reflect.ClassField = 5;', 'TypeError');
  // `Reflect.Type` is the exception the design already names: it "is the one
  // reflection target that is not also a decorator context", and its
  // reflection is discriminated by the STRUCTURE it reports rather than by the
  // context's name, so its own name never appears in one.
  expect(evaluated('String(Reflect.getReflection.<Reflect.Type, uint8>() is Reflect.Type);')).toBe('true');
});

test('the library nominals this branch sits in front of are unaffected', () => {
  // The fix inserts a branch BEFORE the global-constructor lookup, so the
  // regression to watch is that lookup still deciding what it decided. `Error`,
  // `Map`, and the rest are nominal types whose values are instances of a
  // global, and they reach the branch below this one.
  expect(evaluated('let e: Error = new TypeError("x"); "ok";')).toBe('ok');
  expect(evaluated('let m: Map = new Map(); "ok";')).toBe('ok');
  expect(evaluated('let s: Set = new Set(); "ok";')).toBe('ok');
  expect(rejectionKind('let e: Error = 5;')).toBe('TypeError');
});

test('PINNED: the two pieces of #sec-decorator-application still outstanding', () => {
  // 1. THE ARGUMENT FORM IS A FACTORY, WHICH THE CLAUSE REJECTS IN AS MANY
  // WORDS. #sec-decorator-application: "`@f`, `@f(0)`, and `@f('a')` may name
  // three declarations of f and select among them THE WAY ANY CALL DOES", and
  // its note: "Types are what remove the `(value, context)` return from a
  // decorator that takes arguments ... giving one an argument is EDITING ITS
  // PARAMETER LIST rather than rewriting it into a factory."
  //
  // The engine evaluates `@f(0)` as a call and then applies its RESULT to the
  // context - the TC39 factory model. So `@f(0)` never passes the context to
  // `f` at all, and a decorator declared as the clause describes, with the
  // context last after its arguments, receives *undefined* there.
  expectThrownKind('function f(n: uint8, c: Reflect.ClassField) {} class A { @f(7) a: uint8; }', 'TypeError');
  // The factory that works instead, pinned so the change is visible when it is
  // made: `@g()` calls `g`, and the function `g` returns is applied to the
  // context. Under the clause `@f` and `@f()` are ONE FORM and both would call
  // `g` with the context alone.
  expect(evaluated('const l = []; function g() { return (c) => l.push("called:" + String(c.name)); } class B { @g() x: uint8; } l.join(",");')).toBe('called:x');

  // 2. SELECTION AMONG DECLARATIONS BY CONTEXT TYPE DOES NOT HAPPEN YET, and
  // the reason is one step and not the dispatcher: ApplyDecorators calls the
  // decorator with the context, the engine's overload dispatch is genuinely
  // runtime and value-based (`resolveOverload` over argument VALUES), and it
  // reaches the right answer for ordinary calls - but it types each argument
  // through `RuntimeTypeOf`, which gives a context object a plain structural
  // object type and never the context's nominal. No signature is then viable
  // and the last declaration is what runs.
  //
  // THE DISCRIMINATING FORM: the same two declarations succeed or fail on
  // their ORDER alone, which is exactly what selection would make irrelevant.
  // Declared ClassField-then-Class, a field decoration gets the Class one and
  // is refused; declared the other way round it gets the right one by the luck
  // of being last. Asserting only that the first throws would pass against an
  // implementation that had merely picked badly.
  const two = 'function f(c: Reflect.ClassField) {} function f(c: Reflect.Class) {} ';
  const twoReversed = 'function f(c: Reflect.Class) {} function f(c: Reflect.ClassField) {} ';
  expect(rejectionKind(`${two} class A { @f a: uint8; }`)).toBe('TypeError');
  expect(rejectionKind(`${twoReversed} class A { @f a: uint8; }`)).toBe('NO-THROW');
  expect(rejectionKind(`${two} @f class A {}`)).toBe('NO-THROW');
  expect(rejectionKind(`${twoReversed} @f class A {}`)).toBe('TypeError');
  // Ordinary overload resolution is unaffected and correct, which is what
  // locates the gap at RuntimeTypeOf rather than at the dispatcher.
  expect(evaluated('function g(x: uint8) { return "u8"; } function g(x: string) { return "str"; } g("s") + "/" + g(1);')).toBe('str/u8');
});
