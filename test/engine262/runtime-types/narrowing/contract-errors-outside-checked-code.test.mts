import { test } from 'vitest';
import { expectStaticTypeError } from '../harness.mts';

// #sec-checked-code: a rule about a declared type, or about a global this
// proposal introduces, applies everywhere. Only a program using the proposal can
// reach one, so code outside checked code still gets it before running.

test.each([
  "function f(x: uint8) { return x; } f('a');",
  "function f(x: uint8) { return x; } f(300);",
  "uint8('hello');",
  "new uint8(1);",
  "uint8.byteLength = 9;",
])("a contract on the proposal's own names is refused outside checked code: %s", expectStaticTypeError);
