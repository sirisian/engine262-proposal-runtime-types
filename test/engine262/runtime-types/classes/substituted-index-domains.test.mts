import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-object-types

test("rejects index domain alias closed", () => {
  expectStaticTypeError("type Dict<K: type> = { [key: K]: uint8 }; type Invalid = Dict.<boolean>;");
});

test("rejects index domain interface closed", () => {
  expectStaticTypeError("interface Dict<K: type> { [key: K]: uint8; } type Invalid = Dict.<boolean>;");
});

test("rejects index domain closed use", () => {
  expectStaticTypeError("type Dict<K: type> = { [key: K]: uint8 }; let d: Dict.<boolean> = {};");
});

test("accepts index domain alias control", () => {
  expect(ok("type Dict<K: type> = { [key: K]: uint8 }; type Valid = Dict.<string>; let d: Valid = { x: 1 };")).toBe(true);
});

test("accepts index domain interface formation good", () => {
  expect(ok("interface Dict<K: type> { [key: K]: uint8; } type Valid = Dict.<string>;")).toBe(true);
});

test("nested closed key domain", () => {
  expectStaticTypeError("type D<K: type> = { [key: K]: uint8 }; type Box<K: type> = { d: D.<K> }; type Bad = Box.<boolean>;");
});

test("allowed key union", () => {
  expect(ok("type D<K: type> = { [key: K]: uint8 }; type Good = D.<string | symbol | uint32>;")).toBe(true);
});
