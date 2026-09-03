import { test, expect } from 'vitest';
import { evaluated, expectThrown, run } from '../harness.mts';

/**
 * Spec: #sec-literal-propagation (Literal Propagation) - constants.
 *
 * A `const` bound to a compile-time numeric constant behaves as if its
 * initializer were written at each use: `const K = 3.14` is a `float64` in a
 * `float64` position and a `float32` in a `float32` one.
 *
 * Nothing about the binding changes - no type is inferred, `typeof K` is
 * `'number'`, `K === 3.14` holds. What changes is which value a USE produces,
 * which is the question literal propagation already answers one site earlier.
 */

test('a const of a numeric constant takes its context type', () => {
  // The point of the feature: one constant, two types, in one program - and the
  // same two values the inline literal produces.
  expect(evaluated('const K = 3.14; let a: float64 = 2.0; let b: float32 = 2.0; String(Number(K * a)) + "/" + String(Number(K * b));')).toBe('6.28/6.28000020980835');
  expect(evaluated('let a: float64 = 2.0; let b: float32 = 2.0; String(Number(3.14 * a)) + "/" + String(Number(3.14 * b));')).toBe('6.28/6.28000020980835');
  // Computed initializers qualify.
  expect(evaluated('const T = 2 * 3.14; let a: float64 = 2.0; String(Number(T * a));')).toBe('12.56');
  expect(evaluated('const T = (1 + 2) * 3; let n: uint8 = 2; String(Number(T * n));')).toBe('18');
  // Representability decides admissibility, by the rule literals already use.
  expect(evaluated('const C = 3; let n: uint8 = 2; String(Number(C * n));')).toBe('6');
  expectThrown('const C = 999; let n: uint8 = 2; C * n;');
});

test('a reference to a marked const is itself constant', () => {
  // Without this the feature applies exactly one level deep, and
  // `const TAU = 2 * PI` is refused for a reason no user could state.
  expect(evaluated('const A = 3.14; const B = A * 2; let r: float64 = 2.0; String(Number(B * r));')).toBe('12.56');
  expect(evaluated('const A = 3.14; const B = A * 2; let a: float64 = 2.0; let b: float32 = 2.0; String(Number(B * a)) + "/" + String(Number(B * b));')).toBe('12.56/12.5600004196167');
  expect(evaluated('const A = 2; const B = A * 2; const C = B * 2; let n: uint8 = 2; String(Number(C * n));')).toBe('16');
  expect(evaluated('const A = 0.1; const B = A; let b: float32 = 1.0; String(Number(B * b));')).toBe('0.10000000149011612');
  // A chain through a `let` does not qualify, because the `let` does not.
  expectThrown('let A = 3.14; const B = A * 2; let r: float64 = 2.0; B * r;');
});

test('a `let` does not adopt, and shadowing is respected', () => {
  // A mutable binding's type is fixed, or a reassignment has nothing to check
  // against. `let` is the spelling for an ordinary `number` variable.
  expectThrown('let K = 0.1; let a: float32 = 2.0; K * a;');
  // An inner `let` shadows an outer adopting `const` and must not inherit it.
  // The value 0.1 discriminates; 2.0 would not, being exact in both types.
  expectThrown('const K = 3.14; function g(){ let K = 0.1; let a: float32 = 2.0; return K * a; } g();');
  expectThrown('const K = 3.14; { let K = 0.1; let a: float32 = 2.0; K * a; }');
  expectThrown('const K = 0.1; function g(K){ let a: float32 = 2.0; return K * a; } g(0.1);');
  // An inner `const` correctly still adopts.
  expect(evaluated('const K = 3.14; function g(){ const K = 0.1; let a: float32 = 2.0; return Number(K * a); } String(g());')).toBe('0.20000000298023224');
});

test('a `let` of a constant gets a diagnostic that carries the fix', () => {
  // The failure is correct - a mutable binding's type must be fixed, or a
  // reassignment has nothing to check against - but it is the one case here with
  // a one-word fix, so the message says so rather than reporting an unexplained
  // mismatch. It names the position's actual type, and fires on either side.
  const msg = (src: string): string => {
    const c = run(src) as { Type: string, Value?: { HostDefinedMessageString?: string } };
    return c.Type === 'throw' ? String(c.Value?.HostDefinedMessageString) : 'no-throw';
  };
  expect(msg('let K = 3.14; let r: float64 = 2.0; K * r;')).toContain('declare it "const"');
  expect(msg('let K = 3.14; let r: float64 = 2.0; K * r;')).toContain('"float64"');
  expect(msg('let K = 3.14; let r: float64 = 2.0; r * K;')).toContain('declare it "const"');
  expect(msg('let K = 0.1; let a: float32 = 2.0; K * a;')).toContain('"float32"');
  // A `let` whose initializer is NOT a compile-time constant has no such fix,
  // so it keeps the ordinary message.
  expect(msg('function f(){ return 3.14; } let K = f(); let r: float64 = 2.0; K * r;')).toContain('do not mix');
  expect(msg('function anyv(){ return 3.14; } let r: float64 = 2.0; anyv() * r;')).toContain('do not mix');
});

test('nothing observable about the binding changes', () => {
  expect(evaluated('const K = 3.14; typeof K;')).toBe('number');
  expect(evaluated('const K = 3.14; String(K === 3.14);')).toBe('true');
  // Untyped code is unchanged: with no contextual type the constant is a number.
  expect(evaluated('const K = 3.14; String(K * 2);')).toBe('6.28');
  // A non-constant initializer does not qualify.
  expectThrown('function f(){ return 3.14; } const K = f(); let a: float64 = 2.0; K * a;');
  // An annotation pins the type, which is how a plain `number` is requested.
  expect(evaluated('const n: number = 5; String((5 := uint8) === n);')).toBe('false');
});

test('with no contextual type, an adopting constant is a `number`', () => {
  // Untyped code must run unchanged - this proposal's rule - which is also what
  // keeps the design on the right side of Haskell's monomorphism restriction:
  // a polymorphic binding with no default answer is where that language's
  // ambiguity confusion comes from.
  expect(evaluated('const K = 3.14; String(K * 2);')).toBe('6.28');
  expect(evaluated('const K = 3.14; K + "x";')).toBe('3.14x');
  expect(evaluated('const K = 3.14; String(K > 3);')).toBe('true');
  expect(evaluated('const K = 3.14; JSON.stringify({ v: K });')).toBe('{"v":3.14}');
  expect(evaluated('const K = 3.14; function f(x) { return x * 2; } String(f(K));')).toBe('6.28');
  // The same for a well-known constant.
  expect(evaluated('String(Math.PI * 2);')).toBe('6.283185307179586');
  expect(evaluated('typeof Math.PI;')).toBe('number');
});

test('a constant inside a container does NOT adopt', () => {
  // Decided, and asserted so the decision is visible rather than incidental. The
  // reason is MUTABILITY: a property can be assigned, so it cannot carry a type
  // decided per read, and tracking provenance into a container would be the
  // inference this design does not do. Freezing does not change it - the rule is
  // about what the type system tracks, not what the value happens to allow.
  expectThrown('const o = { r: 3.14 }; let a: float64 = 2.0; o.r * a;');
  expectThrown('const arr = [3.14]; let a: float64 = 2.0; arr[0] * a;');
  expectThrown('const { r } = { r: 3.14 }; let a: float64 = 2.0; r * a;');
  expectThrown('const [x] = [3.14]; let a: float64 = 2.0; x * a;');
  expectThrown('const o = Object.freeze({ r: 3.14 }); let a: float64 = 2.0; o.r * a;');
  // The escape is the one every other type uses: annotate.
  expect(evaluated('const o: { r: float64 } = { r: 3.14 }; let a: float64 = 2.0; String(Number(o.r * a));')).toBe('6.28');
});

test('every typed position adopts, for a literal and a const alike', () => {
  expect(evaluated('const K = 0.1; function f(): float32 { return K; } String(Number(f()));')).toBe('0.10000000149011612');
  expect(evaluated('const K = 0.1; function f(x: float32): float32 { return x; } String(Number(f(K)));')).toBe('0.10000000149011612');
  expect(evaluated('const K = 0.1; let a: float32 = 0.1; String(a == K);')).toBe('true');
  expect(evaluated('const K = 0.1; let arr: [1].<float32> = [K]; String(Number(arr[0]));')).toBe('0.10000000149011612');
  expect(evaluated('const K = 0.1; let a: float32 = K; String(Number(a));')).toBe('0.10000000149011612');
});

// -- Math constants ------------------------------------------------------------

/*
 * Math constants (#sec-literal-propagation): `Math.PI * s.radius ** 2` fails
 * when `Math.PI` stays a plain `number`, because a `float64` will not mix
 * with one. A well-known numeric constant takes its position's type, as a
 * literal does - the one case needing a list, because none of these can be
 * WRITTEN as a literal that denotes it.
 *
 * Narrowing the `float64` value to the position's type is CORRECTLY ROUNDED
 * rather than double rounding: an intermediate of 2p+2 bits rounds equivalently
 * to rounding once, and `float64`'s 53 bits cover `float32`'s 50 and
 * `float16`'s 24. Checked for all eight constants at both widths.
 */

test('a Math constant takes its context type', () => {
  // The reported case.
  expect(evaluated('let r: float64 = 1.5; String(Number(Math.PI * r * r));')).toBe('7.0685834705770345');
  // The same constant at a narrower type gives that type's value.
  expect(evaluated('let r: float32 = 2.0; String(Number(Math.PI * r));')).toBe('6.2831854820251465');
  expect(evaluated('let r: float64 = 2.0; String(Number(Math.E * r));')).toBe('5.43656365691809');
  expect(evaluated('let r: float32 = 1.0; String(Number(Math.LN10 * r));')).toBe('2.3025851249694824');
  expect(evaluated('let r: float64 = 1.0; String(Number(Math.SQRT2 * r));')).toBe('1.4142135623730951');
});

test('every named constant participates, at every float width', () => {
  // All eight - `LOG10E` and `LN10` in particular, the constants most
  // likely to differ under a double rounding. The expected values are the
  // correctly-rounded ones computed independently, not read back from the
  // engine, so this asserts the ROUNDING and not merely that a value arrives.
  const at32 = (name: string) => evaluated(`let r: float32 = 1.0; String(Number(Math.${name} * r));`);
  expect(at32('PI')).toBe('3.1415927410125732');
  expect(at32('E')).toBe('2.7182817459106445');
  expect(at32('LN2')).toBe('0.6931471824645996');
  expect(at32('LN10')).toBe('2.3025851249694824');
  expect(at32('LOG2E')).toBe('1.4426950216293335');
  expect(at32('LOG10E')).toBe('0.4342944920063019');
  expect(at32('SQRT2')).toBe('1.4142135381698608');
  expect(at32('SQRT1_2')).toBe('0.7071067690849304');

  // And at `float16`, the narrower target, where the 2p+2 argument has the least
  // margin: 53 bits against the 24 that width requires.
  const at16 = (name: string) => evaluated(`let r: float16 = 1.0; String(Number(Math.${name} * r));`);
  expect(at16('PI')).toBe('3.140625');
  expect(at16('E')).toBe('2.71875');
  expect(at16('LN2')).toBe('0.693359375');
  expect(at16('LOG10E')).toBe('0.434326171875');
  expect(at16('SQRT2')).toBe('1.4140625');
});

test('nothing observable about the property changes', () => {
  expect(evaluated('String(Math.PI);')).toBe('3.141592653589793');
  expect(evaluated('String(Math.PI === 3.141592653589793);')).toBe('true');
  // Still a non-writable, non-configurable DATA property - not an accessor,
  // which would have been observable here and a web-compatibility break.
  expect(evaluated('const d = Object.getOwnPropertyDescriptor(Math, "PI"); String(d.writable) + "/" + String(d.configurable) + "/" + (typeof d.get);')).toBe('false/false/undefined');
});

test('representability still decides, and the limits do not participate', () => {
  // `Math.PI` is not a `uint8`, exactly as the literal would not be.
  expectThrown('let n: uint8 = 2; Math.PI * n;');
  // `Number`'s limits are facts about a REPRESENTATION, not real numbers, so
  // they do not adopt: `Number.MAX_SAFE_INTEGER` as a `float32` would not be the
  // maximum safe integer of anything.
  expectThrown('let r: float32 = 1.0; Number.MAX_SAFE_INTEGER * r;');
});

test('a union containing bigint does not capture an integer literal', () => {
  // `bigintTarget` answered
  // true for a union if ANY arm was `bigint`, without asking whether another arm
  // already accepted the literal as written - so the literal propagated to
  // `bigint` and the binding held a BigInt the program never wrote:
  //
  //   let x: number | bigint = 5;
  //   typeof x   // was "bigint"    x === 5   // was false    x + 1  // threw
  //
  // #sec-type-membership makes a union's arms ALTERNATIVES - a value belongs to
  // a union if it belongs to ANY member - so a literal already belonging to one
  // arm has no reason to be converted for another.
  expect(evaluated('let x: number | bigint = 5; String(typeof x);')).toBe('number');
  expect(evaluated('let x: number | bigint = 5; String(x === 5);')).toBe('true');
  expect(evaluated('let x: bigint | number = 5; String(typeof x);')).toBe('number');
  expect(evaluated('let x: number | bigint | string = 5; String(typeof x);')).toBe('number');
  // A SIZED numeric arm too - an earlier reading thought these escaped, having
  // measured them with a cast rather than a literal.
  expect(evaluated('let x: int8 | bigint = 5; String(typeof x);')).toBe('number');
});

test('the corrupted value no longer escapes into untyped code', () => {
  // The severity of item S was that the wrong value LEFT the typed world: it
  // reached ordinary JavaScript, where a BigInt does not mix with a Number.
  expect(evaluated('let x: number | bigint = 5; String(x + 1);')).toBe('6');
  expect(evaluated('let x: number | bigint = 5; let y = x; String(typeof y);')).toBe('number');
  expect(evaluated('let x: number | bigint = 5; JSON.stringify({ v: x });')).toBe('{"v":5}');
  // Every position that applies the type, not only a `let`.
  expect(evaluated('class C { f: number | bigint = 5; } String(typeof new C().f);')).toBe('number');
  expect(evaluated('function g(): number | bigint { return 5; } String(typeof g());')).toBe('number');
  expect(evaluated('function h(v: number | bigint) { return typeof v; } String(h(5));')).toBe('number');
});

test('what the bigint fix must not disturb', () => {
  // A genuine BigInt literal still reaches the bigint arm - it has no other way
  // into the union, and a blanket "do not propagate to bigint" loses it. This is
  // the guard the obvious fix breaks.
  expect(evaluated('let x: number | bigint = 5n; String(typeof x);')).toBe('bigint');
  expect(evaluated('let x: number | bigint = 5n; String(x === 5n);')).toBe('true');
  // A `bigint` annotation with no competing arm still propagates.
  expect(evaluated('let x: bigint = 5; String(typeof x);')).toBe('bigint');
  // A non-integer was never affected: it is not an exact BigInt.
  expect(evaluated('let x: number | bigint = 5.5; String(typeof x);')).toBe('number');
  // The narrowing conversion path is untouched - `5` is not a `uint8` value
  // until it is converted, and that conversion must still happen. A fix aimed at
  // "stop converting for unions" passes every row above and breaks this one.
  expect(evaluated('let a: uint8 | string = 5; String(a is uint8);')).toBe('true');
});
