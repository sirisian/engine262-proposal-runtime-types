import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion } from '#self';

// #sec-proved-library-operations

test("rejects const n: uint8 = 1; Object.create(n);", () => {
  expectStaticTypeError("const n: uint8 = 1; Object.create(n);");
});

test("rejects const x: {a: uint8} = {a: 1}; const n: uint8 = 1; Object.setPrototypeOf(x, n);", () => {
  expectStaticTypeError("const x: {a: uint8} = {a: 1}; const n: uint8 = 1; Object.setPrototypeOf(x, n);");
});

test("accepts Object.create(null);", () => {
  expect(ok("Object.create(null);")).toBe(true);
});

test("accepts Object.create({});", () => {
  expect(ok("Object.create({});")).toBe(true);
});

test("accepts const n: uint8 = 1; Object.setPrototypeOf(n, null);", () => {
  expect(ok("const n: uint8 = 1; Object.setPrototypeOf(n, null);")).toBe(true);
});

test("preserves a replacement for const n: uint8 = 1; Object.create(n);", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("Object.create = function () { return {}; };")).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("const n: uint8 = 1; Object.create(n);")).Type).toBe('normal');
});

test("accepts const Object = {create(n) { return {}; }}; const n: uint8 = 1; Object.create(n);", () => {
  expect(ok("const Object = {create(n) { return {}; }}; const n: uint8 = 1; Object.create(n);")).toBe(true);
});

test("accepts function f(n: any) { return Object.create(n); }", () => {
  expect(ok("function f(n: any) { return Object.create(n); }")).toBe(true);
});
