import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, Get, Value, X, ObjectValue } from '#self';

// #sec-array-defaults-and-stores

test("rejects const a: [2].<uint8> = [1, 2]; a.set([\"s\"]);", () => {
  expectStaticTypeError("const a: [2].<uint8> = [1, 2]; a.set([\"s\"]);");
});

test("rejects const a: [2].<uint8> = [1, 2]; a.set({0: \"s\", length: 1});", () => {
  expectStaticTypeError("const a: [2].<uint8> = [1, 2]; a.set({0: \"s\", length: 1});");
});

test("rejects const a: [2].<uint8> = [1, 2]; a.window(0, 2).set([\"s\"]);", () => {
  expectStaticTypeError("const a: [2].<uint8> = [1, 2]; a.window(0, 2).set([\"s\"]);");
});

test("accepts const a: [2].<uint8> = [1, 2]; a.set({0: 3, length: 1});", () => {
  expect(ok("const a: [2].<uint8> = [1, 2]; a.set({0: 3, length: 1});")).toBe(true);
});

test("accepts const a: [2].<uint8> = [1, 2]; a.set({0: \"s\", length: 0});", () => {
  expect(ok("const a: [2].<uint8> = [1, 2]; a.set({0: \"s\", length: 0});")).toBe(true);
});

test("accepts const a: [2].<uint8> = [1, 2]; const offset: string = \"s\"; a.set([1], offset);", () => {
  expect(ok("const a: [2].<uint8> = [1, 2]; const offset: string = \"s\"; a.set([1], offset);")).toBe(true);
});

test("preserves a replacement for const a: [2].<uint8> = [1, 2]; a.set([\"s\"]);", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("const seed: [2].<uint8> = [1, 2]; Object.getPrototypeOf(seed).set = function () {};")).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("const a: [2].<uint8> = [1, 2]; a.set([\"s\"]);")).Type).toBe('normal');
});

test("accepts function f(source: any) { const a: [2].<uint8> = [1, 2]; a.set(source); }", () => {
  expect(ok("function f(source: any) { const a: [2].<uint8> = [1, 2]; a.set(source); }")).toBe(true);
});

test("accepts const a: [2].<uint8> = [1, 2]; a.set({ get 0() { return 3; }, length: 1 });", () => {
  expect(ok("const a: [2].<uint8> = [1, 2]; a.set({ get 0() { return 3; }, length: 1 });")).toBe(true);
});

test("preserves runtime precedence for const a: [2].<uint8> = [1, 2]; a.set([\"s\"], 2);", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  realm.evaluateScriptSkipDebugger('globalThis.reached = false;');
  const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger("globalThis.reached = true;const a: [2].<uint8> = [1, 2]; a.set([\"s\"], 2);"));
  expect(completion.Type).toBe('throw');
  const pop = realm.pushTopContext();
  try {
    expect((X(Get(X(Get(completion.Value as ObjectValue, Value('constructor'))) as ObjectValue, Value('name'))) as {stringValue(): string}).stringValue()).toBe("RangeError");
  } finally {
    pop?.();
  }
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('globalThis.reached;')).Value).toBe(Value.true);
});
