import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

function run(source: string, runtimeTypes = true) {
  setSurroundingAgent(new Agent(runtimeTypes ? { features: ['runtime-types'] } : {}));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectOk(source: string) {
  expect(run(source)).toMatchObject({ Type: 'normal' });
}

function expectTypeError(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

test('annotated bindings are checked against their initializers', () => {
  expectTypeError('let x: uint8 = "s";');
  expectTypeError('let x: uint8 = 300;');
  expectOk('let x: uint8 = 5;');
  expectTypeError('var v: string = 5;');
  expectOk('var v: string = "ok";');
});

test('assignments to declared bindings are checked', () => {
  expectTypeError('let a: uint8 = 5; a = "x";');
  expectOk('let a: uint8 = 5; a = 7;');
  expectTypeError('function g(a: uint8) { a = "x"; }');
});

test('typed initializers infer a widened type', () => {
  expectOk('let x := 5; x = 6;');
  expectTypeError('let x := 5; x = "s";');
  expectOk('let s := "a"; s = "b";');
});

test('aliases resolve statically', () => {
  expectTypeError('type T = uint8; let x: T = 300;');
  expectOk('type T = uint8; let x: T = 3;');
  expectTypeError('type S = string; let n: S = 5;');
});

test('return statements are checked against the annotation', () => {
  expectTypeError('function f(): uint8 { return "s"; }');
  expectOk('function f(): uint8 { return 5; }');
  expectTypeError('const f = (): string => { return 5; };');
});

test('unions and unknown types', () => {
  expectOk('let u: uint8 | string = "s"; u = 3;');
  expectTypeError('let u: uint8 | string = true;');
  // A type the checker cannot resolve is unknown, and unknown is any:
  // silence statically, with the annotation evaluated at run time. Here the
  // type is a first-class Type Object bound by an expression.
  expectOk('const Mystery = type uint8 | string; let y: Mystery = "s"; y = 5;');
});

test('unannotated programs stay silent', () => {
  expectOk('let a = 1; a = "s"; function f() { return a; } f();');
});
