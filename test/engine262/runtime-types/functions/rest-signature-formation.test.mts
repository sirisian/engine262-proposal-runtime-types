import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-function-types

test("rejects rest scalar function type", () => {
  expectStaticTypeError("type F = (...values: uint8) => void;");
});

test("rejects rest scalar interface call", () => {
  expectStaticTypeError("interface F { (...values: uint8): void; }");
});

test("rejects rest scalar interface method", () => {
  expectStaticTypeError("interface F { m(...values: uint8): void; }");
});

test("rejects rest scalar abstract method", () => {
  expectStaticTypeError("abstract class C { m(...values: uint8): void; }");
});

test("rejects rest type generic unbound", () => {
  expectStaticTypeError("type F<T: type> = (...values: T) => void;");
});

test("accepts rest type array control", () => {
  expect(ok("type F = (...values: [].<uint8>) => void; let f: F = (...values) => {}; f(1, 2);")).toBe(true);
});

test("accepts rest type alias control", () => {
  expect(ok("type Values = [].<uint8>; type F = (...values: Values) => void;")).toBe(true);
});

test("accepts rest type generic bound", () => {
  expect(ok("type F<T: type extends [].<any>> = (...values: T) => void;")).toBe(true);
});

test("accepts rest abstract array good", () => {
  expect(ok("abstract class C { m(...values: [].<uint8>): void; }")).toBe(true);
});

test("unnamed scalar rest", () => {
  expectStaticTypeError("type F = (...uint8) => void;");
});

test("tuple rest signature", () => {
  expect(ok("type F = (...values: [uint8, string]) => void;")).toBe(true);
});

test("scalar rest through alias", () => {
  expectStaticTypeError("type Scalar = uint8; interface I { m(...values: Scalar): void; }");
});

test('abstract generic rest requires a collection bound', () => {
  expectStaticTypeError('abstract class C<T: type> { m(...values: T): void; }');
});

test('abstract generic rest uses the class collection bound', () => {
  expect(ok('abstract class C<T: type extends [].<any>> { m(...values: T): void; }')).toBe(true);
});
