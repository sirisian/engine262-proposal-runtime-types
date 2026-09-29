import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, Get, Value, X } from '#self';

// #sec-typed-promise-executors

test("rejects const n: uint8 = 1; new Promise.<uint8>(n);", () => {
  expectStaticTypeError("const n: uint8 = 1; new Promise.<uint8>(n);");
});

test("rejects new Promise.<uint8>((resolve: (string) => void, reject: any) => {});", () => {
  expectStaticTypeError("new Promise.<uint8>((resolve: (string) => void, reject: any) => {});");
});

test("accepts new Promise.<uint8>((resolve, reject) => { resolve(1); });", () => {
  expect(ok("new Promise.<uint8>((resolve, reject) => { resolve(1); });")).toBe(true);
});

test("accepts function f(x: any) { new Promise.<uint8>(x); }", () => {
  expect(ok("function f(x: any) { new Promise.<uint8>(x); }")).toBe(true);
});

test("accepts class Promise<T: type> { constructor(n: uint8) {} } const n: uint8 = 1; new Promise.<uint8>(n);", () => {
  expect(ok("class Promise<T: type> { constructor(n: uint8) {} } const n: uint8 = 1; new Promise.<uint8>(n);")).toBe(true);
});

test("preserves a replacement for const n: uint8 = 1; new Promise.<uint8>(n);", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("globalThis.Promise = class P<T: type> { constructor(n: uint8) {} };")).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("const n: uint8 = 1; new Promise.<uint8>(n);")).Type).toBe('normal');
});

test("preserves runtime precedence for new Promise(1);", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  realm.evaluateScriptSkipDebugger('globalThis.reached = false;');
  const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger("globalThis.reached = true;new Promise(1);"));
  expect(completion.Type).toBe('throw');
  const pop = realm.pushTopContext();
  try {
    expect((X(Get(X(Get(completion.Value, Value('constructor'))), Value('name'))) as {stringValue(): string}).stringValue()).toBe("TypeError");
  } finally {
    pop?.();
  }
  expect(realm.evaluateScriptSkipDebugger('globalThis.reached;').Value).toBe(Value.true);
});


test('typed construction requires a supplied callable executor', () => {
  expectStaticTypeError('new Promise.<uint8>();');
  expectStaticTypeError('new Promise.<uint8>(null);');
});

test('earlier structural conversion can replace the Promise constructor', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('globalThis.input={get x(){globalThis.Promise=class P<T:type>{constructor(value){}};return 1;}};')).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('const a:{readonly x:number}=input;const n:uint8=1;new Promise.<uint8>(n);')).Type).toBe('normal');
});
