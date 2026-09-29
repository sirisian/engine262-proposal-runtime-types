import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, Get, Value, X } from '#self';

// #sec-proved-library-operations

test("rejects Reflect.defineProperty({(x: uint8): 0}, \"x\", {value: \"s\"});", () => {
  expectStaticTypeError("Reflect.defineProperty({(x: uint8): 0}, \"x\", {value: \"s\"});");
});

test("rejects Object.defineProperties({(x: uint8): 0}, {x: {value: \"s\"}});", () => {
  expectStaticTypeError("Object.defineProperties({(x: uint8): 0}, {x: {value: \"s\"}});");
});

test("rejects Object.defineProperty({(x: uint8): 0}, \"x\", {value: \"s\"});", () => {
  expectStaticTypeError("Object.defineProperty({(x: uint8): 0}, \"x\", {value: \"s\"});");
});

test("accepts Reflect.defineProperty({(x: uint8): 0}, \"x\", {value: 1});", () => {
  expect(ok("Reflect.defineProperty({(x: uint8): 0}, \"x\", {value: 1});")).toBe(true);
});

test("accepts Object.defineProperties({(x: uint8): 0}, {x: {value: 1}});", () => {
  expect(ok("Object.defineProperties({(x: uint8): 0}, {x: {value: 1}});")).toBe(true);
});

test("preserves a replacement for Reflect.defineProperty({(x: uint8): 0}, \"x\", {value: \"s\"});", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("Reflect.defineProperty = function () { return true; };")).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("Reflect.defineProperty({(x: uint8): 0}, \"x\", {value: \"s\"});")).Type).toBe('normal');
});

test("preserves a replacement for Object.defineProperties({(x: uint8): 0}, {x: {value: \"s\"}});", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("Object.defineProperties = function (o) { return o; };")).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("Object.defineProperties({(x: uint8): 0}, {x: {value: \"s\"}});")).Type).toBe('normal');
});

test("accepts function f(value: any) { Reflect.defineProperty({(x: uint8): 0}, \"x\", {value}); }", () => {
  expect(ok("function f(value: any) { Reflect.defineProperty({(x: uint8): 0}, \"x\", {value}); }")).toBe(true);
});

test("preserves runtime precedence for Object.defineProperties({(x: uint8): 0}, {x: {value: \"s\"}, y: {get: 1}});", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  realm.evaluateScriptSkipDebugger('globalThis.reached = false;');
  const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger("globalThis.reached = true;Object.defineProperties({(x: uint8): 0}, {x: {value: \"s\"}, y: {get: 1}});"));
  expect(completion.Type).toBe('throw');
  const pop = realm.pushTopContext();
  try {
    expect((X(Get(X(Get(completion.Value, Value('constructor'))), Value('name'))) as {stringValue(): string}).stringValue()).toBe("TypeError");
  } finally {
    pop?.();
  }
  expect(realm.evaluateScriptSkipDebugger('globalThis.reached;').Value).toBe(Value.true);
});
