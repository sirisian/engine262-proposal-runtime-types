import { expect, test } from 'vitest';
import { expectEarlyError, ok } from '../harness.mts';

// #sec-variance-static-semantics-early-errors

test("rejects partial variance input", () => {
  expectEarlyError("class Box<out T: type> {} partial class Box { put(value: T): void {} }", 'SyntaxError');
});

test("rejects partial variance output", () => {
  expectEarlyError("class Box<in T: type> {} partial class Box { get(): T { throw 0; } }", 'SyntaxError');
});

test("rejects partial variance interface", () => {
  expectEarlyError("interface Box<out T: type> {} partial interface Box { put(value: T): void; }", 'SyntaxError');
});

test("rejects partial variance capture", () => {
  expectEarlyError("class Box<out T: type> {} partial class Box<const E> { put(value: E): void {} }", 'SyntaxError');
});

test("accepts partial variance fixed control", () => {
  expect(ok("class Box<out T: type> {} partial class Box<uint8> { put(value: uint8): void {} }")).toBe(true);
});

test("accepts partial variance output control", () => {
  expect(ok("class Box<out T: type> {} partial class Box { get(): T { throw 0; } }")).toBe(true);
});

test("accepts partial variance shadow control", () => {
  expect(ok("class Box<out T: type> {} partial class Box { put<T: type>(value: T): void {} }")).toBe(true);
});

test("nested covariant capture input", () => {
  expectEarlyError("class Inner<out T: type> {} class Outer<out T: type> {} partial class Outer<Inner.<const E>> { put(x: E): void {} }", 'SyntaxError');
});

test("invariant family contribution", () => {
  expect(ok("class C<T: type> {} partial class C { put(x: T): void {} }")).toBe(true);
});

test("fixed primary parameter in input", () => {
  expect(ok("class C<out T: type> {} partial class C<uint8> { put(x: T): void {} }")).toBe(true);
});
