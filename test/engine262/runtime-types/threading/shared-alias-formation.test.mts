import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// Spec: #sec-threading-shared-modifier. "An open operand retains this formation
// obligation": once an alias or a generic closes the operand of `shared`, the same
// requirements as for a written `shared T` apply - a value type, not a reference,
// not itself `shared` - in an unused signature and in nested type positions (an
// array element, a function parameter, an object member). A resolved violation is a
// type error before the source runs; an open or valid operand is accepted.

// Closed operands that violate the obligation: refused.
test.each([
  [
    "closed shared signature operand",
    "type S<T:type> = shared T; function unused(x:S.<string>) {}"
  ],
  [
    "shared generic",
    "type S<T:type> = shared T; type Bad = S.<string>;"
  ],
  [
    "shared generic nested",
    "type S<T:type> = shared T; type Bad = S.<shared uint8>;"
  ],
  [
    "generic shared nested object",
    "type S<T:type>={x:shared T}; function f(x:S.<string>){}"
  ],
  [
    "shared alias inside an array",
    "type S<T:type>=shared T; function unused(x:[].<S.<string>>){}"
  ],
  [
    "shared alias inside a function",
    "type S<T:type>=shared T;function unused(x:(a:S.<string>)=>void){}"
  ]
])('%s', (_name, source) => {
  expectStaticTypeError(source);
});

// Valid closed operands, and open aliases that defer the check: accepted.
test.each([
  [
    "shared generic good",
    "type S<T:type> = shared T; type Good = S.<uint8>;"
  ],
  [
    "generic shared alias bound",
    "type S<T:type extends value> = shared T; function f(x:S.<uint8>){}"
  ],
  [
    "open shared alias",
    "type S<T:type>=shared T;"
  ],
  [
    "nested closed scalar alias",
    "type S<T:type>={x:shared T};function unused(x:S.<uint8>){}"
  ]
])('%s', (_name, source) => {
  expect(ok(source)).toBe(true);
});
