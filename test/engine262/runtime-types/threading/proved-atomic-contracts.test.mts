import { expect, test } from 'vitest';
import { evaluatedSequence, expectStaticTypeError, ok } from '../harness.mts';

// Spec: #sec-proved-library-operations (the paragraph on a proved typed Atomics
// operation), #sec-atomics-typed-operations and #sec-atomics-reference-arguments.
//
// A call to an intrinsic `Atomics` operation whose callee is established is
// checked before the source runs. It is a type error if the known target category
// cannot satisfy the operation's restriction (an integer-only operation over a
// floating-point target, a first argument that is not a `ref`), or if an
// established operand necessarily fails its conversion. `shared` is not an
// eligibility requirement. A conversion that may be skipped - the replacement of a
// `compareExchange` whose expected value does not match - is not established by
// the presence of its argument, and a replaced `Atomics` removes the proof, so
// those calls stay a run-time matter.

// Refused before the source runs. In order: an integer-only operation over a
// float64 target; a non-numeric stored operand; a first argument that is not a
// `ref`; `waitAsync` (integer-only) over a float64; a float64 property under an
// integer-only operation; a non-numeric operand to an arithmetic operation.
test.each([
  [
    "integer atomic operation requires integer storage",
    "let n: float64 = 1; Atomics.and(ref n, 1);"
  ],
  [
    "atomics operand",
    "let n: uint8 = 1; Atomics.store(ref n, \"x\");"
  ],
  [
    "atomics no ref",
    "let n: uint8 = 1; Atomics.add(n, 1);"
  ],
  [
    "atomics float wait",
    "let n:float64=1; Atomics.waitAsync(ref n,0);"
  ],
  [
    "atomics property invalid",
    "const o={(n:float64):1}; Atomics.and(o,\"n\",1);"
  ],
  [
    "atomic arithmetic refuses nonnumeric operand",
    "let n:uint8=1;Atomics.add(ref n,\"s\");"
  ]
])('%s', (_name, source) => {
  expectStaticTypeError(source);
});

// Accepted. In order: an integer-only operation over an integer; `add` over a
// float64 (add and sub admit the floating-point types); `Atomics.and` replaced by
// a user function; `shared` storage; a typed integer property; an out-of-range
// operand; the replacement of an unmatched `compareExchange`; a replaced global
// `Atomics`.
test.each([
  [
    "atomics and ok",
    "let n:uint8=1; Atomics.and(ref n,1);"
  ],
  [
    "atomics add float ok",
    "let n:float64=1; Atomics.add(ref n,1);"
  ],
  [
    "atomics replaced",
    "Atomics.and=(...xs)=>0; let n:float64=1; Atomics.and(ref n,1);"
  ],
  [
    "atomics shared ok",
    "let n:shared uint8=1; Atomics.and(ref n,1);"
  ],
  [
    "atomics property",
    "const o={(n:uint8):1}; Atomics.and(o,\"n\",1);"
  ],
  [
    // This pins what the engine does today: an out-of-range operand wraps modulo the
    // target's width (300 stores as 44 in a uint8). #sec-atomics-typed-operations says
    // a stored value passes the typed-storage boundary, under which the same value is a
    // RangeError, so this case documents a divergence from the clause.
    "explicit atomic conversion can wrap",
    "let n:uint8=1;Atomics.store(ref n,300);"
  ],
  [
    "unmatched compareExchange does not convert replacement",
    "let n:uint8=1;Atomics.compareExchange(ref n,2,\"s\");"
  ],
  [
    "global replacement invalidates origin",
    "globalThis.Atomics={and(...xs){return 0;}};let n:float64=1;Atomics.and(ref n,1);"
  ]
])('%s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test('prior atomic method replacement stays dynamic', () => {
  expect(evaluatedSequence(['Atomics.and=function(){return 0;};', 'let n:float64=1;Atomics.and(ref n,1);"ok";'])).toBe('ok');
});
