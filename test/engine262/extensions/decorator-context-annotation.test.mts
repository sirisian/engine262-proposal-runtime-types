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

test('the rest of #sec-decorator-application, CLOSED (cycle 130)', () => {
  // Both pieces this file pinned are done, and the pins are kept in flipped
  // form: the argument form is no longer a factory, and selection by context
  // type happens. decorator-calling-convention.test.mts owns the assertions;
  // what stays here is that a reader of the old pins finds the new answer.
  expect(evaluated('let got = "never"; function f(n: uint8, c: Reflect.ClassField) { got = String(n) + ":" + String(c.name); } class A { @f(7) a: uint8; } got;')).toBe('7:a');
  const decls = 'const l = []; function f(c: Reflect.ClassField) { l.push("field"); } function f(c: Reflect.Class) { l.push("class"); } ';
  expect(evaluated(`${decls} class A { @f a: uint8; } l.join(",");`)).toBe('field');
  expect(evaluated(`${decls} @f class N {} l.join(",");`)).toBe('class');
  // Ordinary overload resolution, unchanged throughout.
  expect(evaluated('function g(x: uint8) { return "u8"; } function g(x: string) { return "str"; } g("s") + "/" + g(1);')).toBe('str/u8');
});
