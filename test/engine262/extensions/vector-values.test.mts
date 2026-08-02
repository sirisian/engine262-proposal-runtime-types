import { test, expect } from 'vitest';
import { ok, evaluated, expectThrown } from '../readme/harness.mts';

/**
 * PLAN-simd-engine.md phase 1: vector values.
 *
 * Before this the SIMD surface was types without values - `vector.<T, N>` and
 * every shorthand resolved in an annotation and nothing could be built, so no
 * operation could be tested. A vector is a value type whose values are "the
 * sequences of N values of T" (#sec-vector-types), and it carries the Type
 * Record it was built at, since the lane type and count are not recoverable
 * from the lanes alone: `float32x4(1, 2, 3, 4)` and `int32x4(1, 2, 3, 4)` hold
 * equal lane values.
 */

test('a vector type name is a callable Type Object', () => {
  // `typeof uint8` is 'object' and `uint8(5)` constructs; a vector shorthand
  // now behaves the same way, which is the model it follows.
  expect(evaluated('String(typeof float32x4);')).toBe('object');
  expect(evaluated('String(typeof int32x4);')).toBe('object');
  expect(evaluated('String(typeof boolean8);')).toBe('object');
});

test('a vector constructs from its lanes', () => {
  expect(evaluated('String(float32x4(1, 2, 3, 4));')).toBe('(1, 2, 3, 4)');
  expect(evaluated('String(int32x4(4, 3, 2, 1));')).toBe('(4, 3, 2, 1)');
  // A non-shorthand width, through a type alias. `vector` itself is not a
  // binding - only the shorthand names are bound - so the long form is written
  // in an annotation or aliased rather than called directly. Binding `vector`
  // would make it callable as `vector.<float32, 3>(1, 2, 3)` and is phase 2's
  // to decide, since it is the same question the broadcast cast raises.
  expect(evaluated('type F3 = vector.<float32, 3>; String(F3(1, 2, 3));')).toBe('(1, 2, 3)');
});

test('one argument broadcasts to every lane', () => {
  // #sec-vector-lanes gives a vector type a cast operator from its lane type.
  expect(evaluated('String(float32x4(7));')).toBe('(7, 7, 7, 7)');
});

test('a wrong lane count is refused, and the message says both', () => {
  expectThrown('float32x4(1, 2, 3);');
  expectThrown('float32x4(1, 2, 3, 4, 5);');
});

test('a vector satisfies its own type and no other', () => {
  expect(evaluated('let a: float32x4 = float32x4(1, 2, 3, 4); String(a);')).toBe('(1, 2, 3, 4)');
  // The shorthand and the long form are one type, so either annotation accepts.
  expect(evaluated('let a: vector.<float32, 4> = float32x4(1, 2, 3, 4); String(a);')).toBe('(1, 2, 3, 4)');
  expect(ok('function f(x: float32x4) { return x; } f(float32x4(1, 2, 3, 4));')).toBe(true);

  // The two ways it can fail, which are what keep the three above from passing
  // vacuously: a different lane type and a different lane count.
  expect(ok('let a: int32x4 = float32x4(1, 2, 3, 4);')).toBe(false);
  expect(ok('let a: vector.<float32, 2> = float32x4(1, 2, 3, 4);')).toBe(false);
});

test('a vector reports its own type', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(Reflect.typeOf(a) === float32x4);')).toBe('true');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(Reflect.typeOf(a) === int32x4);')).toBe('false');
});

test('typeof a vector is object', () => {
  // A vector is not a primitive of the base language, so `typeof` reports
  // 'object' and its own type is read with Reflect.typeOf. Asserted because a
  // new value kind is answered by every typeof in the language.
  expect(evaluated('String(typeof float32x4(1, 2, 3, 4));')).toBe('object');
});

/**
 * PLAN-simd-engine.md phase 2: lane access.
 *
 * #sec-vector-lanes gives a vector two ways to reach a lane, and they differ in
 * WHEN the lane is chosen. A computed access takes an expression, so no static
 * rule bounds it and an out-of-range index throws a RangeError; the constant
 * form `lane.<I>()` is refused before the program runs. That asymmetry is the
 * reason the design gives both, and it is what these assert.
 *
 */

test('the constant lane forms take a compile-time index', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.lane.<0>());')).toBe('1');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.lane.<3>());')).toBe('4');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a.withLane.<1>(9));')).toBe('(1, 9, 3, 4)');
});

test('an out-of-range constant index is refused before the program runs', () => {
  // The other half of the asymmetry: `a[4]` throws a RangeError at run time
  // because its index is an expression, and `a.lane.<4>()` is refused as a type
  // error because its index is a constant. Both are asserted, in one place, so
  // the difference cannot quietly collapse.
  expectThrown('const a = float32x4(1, 2, 3, 4); a.lane.<4>();');
  expectThrown('const a = float32x4(1, 2, 3, 4); a.withLane.<4>(9);');
  expectThrown('const a = float32x4(1, 2, 3, 4); a[4];');
});

test('withLane leaves the receiver unchanged', () => {
  // A vector is a value type, so `withLane` returns a NEW one. Asserted on the
  // RECEIVER rather than only on the result, which is the assertion that would
  // fail if the lanes were written in place.
  expect(evaluated('const a = float32x4(1, 2, 3, 4); a.withLane.<1>(9); String(a);')).toBe('(1, 2, 3, 4)');
});

test('a replaced lane converts to the lane type', () => {
  expectThrown('const a = int32x4(1, 2, 3, 4); a.withLane.<0>("s");');
});

test('sum adds the lanes', () => {
  // #sec-vector-lanes leaves the ORDER implementation-defined, so an integer
  // lane type is asserted by value and a float one is not: addition is not
  // associative for a binary floating-point lane type, and the clause says two
  // implementations may differ on one receiver. Asserting a float sum's bit
  // pattern would encode this engine's fold as the specification's.
  expect(evaluated('const a = int32x4(1, 2, 3, 4); String(a.sum());')).toBe('10');
  expect(evaluated('const a = int32x4(0, 0, 0, 0); String(a.sum());')).toBe('0');
  expect(ok('const a = float32x4(1.5, 2.5, 3, 4); const s: float32 = a.sum();')).toBe(true);
});

test('a key a vector does not answer is refused, not crashed', () => {
  // A vector is a primitive with no wrapper object, so an unanswered key cannot
  // fall through to ToObject - which asserts rather than boxing. It reports
  // that the name is not a member, and the component accessors will be answered
  // ahead of that as they land.
  expectThrown('const a = float32x4(1, 2, 3, 4); a.nope;');
});

test('a lane is read by index', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a[0]);')).toBe('1');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a[3]);')).toBe('4');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); let i = 2; String(a[i]);')).toBe('3');
  // A string key names the same lane. Both spellings must work, because a
  // member access does not canonicalize its key before the reference resolves.
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a["1"]);')).toBe('2');
});

test('an out-of-range lane read throws at run time', () => {
  // A RangeError rather than a type error: the index is an expression, so it is
  // not known before the program runs. This is the half of the asymmetry that
  // the constant form does not have.
  expectThrown('const a = float32x4(1, 2, 3, 4); a[4];');
  expectThrown('const a = float32x4(1, 2, 3, 4); let i = 9; a[i];');
});

test('a lane is written by index', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); a[1] = 9; String(a);')).toBe('(1, 9, 3, 4)');
  expectThrown('const a = float32x4(1, 2, 3, 4); a[4] = 9;');
});

test('a written lane converts to the lane type', () => {
  // The write goes through the lane type's conversion, so a value that is not
  // one is refused rather than stored.
  expectThrown('const a = int32x4(1, 2, 3, 4); a[0] = "s";');
});

/**
 * PLAN-simd-engine.md phase 2, the broadcast: attempted, reverted, and located
 * more precisely than a stack trace would have shown.
 *
 * #sec-vector-lanes says `vector.<T, N>` declares a cast operator from T, so
 * `let b: float32x4 = s` for a `float32` s should broadcast. The CONVERSION is
 * written and works - `float32x4(2)` gives `(2, 2, 2, 2)`, and
 * CheckedConvertValue fills every lane - but the assignment does not reach it.
 *
 * TWO PATHS GUARD IT AND THEY MUST AGREE. The checker's IsAssignable refuses
 * the assignment statically, before any conversion runs. Making IsAssignable
 * admit a lane type produced something WORSE than the refusal: the assignment
 * was accepted and the value stayed a `float32`, so `Reflect.typeOf(b) ===
 * float32x4` was false and a broadcast had silently not happened. That is a
 * type system admitting a value it did not convert, which is unsound rather
 * than incomplete, so it was reverted.
 *
 * The two halves have to land together: IsAssignable admitting the lane type
 * AND the enforcement path converting rather than passing the value through.
 * requireMembership now attempts CheckedConvertValue when membership fails,
 * which is the second half; the first half needs the checker to tell the
 * enforcement path that a conversion is owed, rather than just permitting the
 * assignment. That is the next step.
 *
 * The refusal is the current behaviour and is correct-but-incomplete: it
 * rejects a program the design permits, rather than accepting one it does not.
 */

test('the broadcast cast fills every lane', () => {
  // The conversion itself, which works: an explicit call broadcasts.
  expect(evaluated('String(float32x4(2));')).toBe('(2, 2, 2, 2)');
  expect(evaluated('String(int32x4(7));')).toBe('(7, 7, 7, 7)');

  // And through an ANNOTATION, which is the design's own spelling. Every case
  // below is from the README verbatim.
  expect(evaluated('let a: float32x4 = 1; String(a);')).toBe('(1, 1, 1, 1)');
  expect(evaluated('let s: float32 = 2; let b: float32x4 = s; String(b);')).toBe('(2, 2, 2, 2)');

  // Soundness, asserted separately: the binding holds a VECTOR, not the lane
  // value the checker admitted. Two earlier attempts passed the assignment and
  // failed this, which is why it is its own assertion rather than trusted.
  expect(evaluated('let s: float32 = 2; let b: float32x4 = s; String(Reflect.typeOf(b) === float32x4);')).toBe('true');

  // Only the LANE type converts: a float32 reaches float32x4 and not
  // float64x2, and the design writes the second as a cast first.
  expect(ok('let s: float32 = 2; let c: float64x2 = s;')).toBe(false);
  expect(evaluated('let s: float32 = 2; let d: float64x2 = float64(s); String(d);')).toBe('(2, 2)');
  expect(ok('let a: float32x4 = "x";')).toBe(false);
});

/**
 * The broadcast, and why it took three attempts to land soundly.
 *
 * #sec-vector-lanes: "`vector.<T, N>` declares a cast operator from T", so a
 * lane value assigned to a vector fills every lane. Every README case works and
 * the result is genuinely a vector.
 *
 * TWO EARLIER ATTEMPTS PUT THE STATIC RULE IN IsAssignable AND WERE UNSOUND.
 * That predicate is consulted by paths which then pass the value through
 * unchanged, so admitting the lane type there let a `float32` sit in a
 * `float32x4` binding unconverted - the assignment succeeded and
 * `Reflect.typeOf(b) === float32x4` was false. Both were reverted.
 *
 * The rule belongs at the checker's REPORT site instead. That site decides
 * whether to complain and nothing else; the value it governs still reaches
 * requireMembership, which performs the conversion. Same admission, opposite
 * soundness, and the difference is only which of two similar-looking functions
 * carries it.
 *
 * A numeric literal needed its own admission, because the literal narrowing
 * above the site returns before this branch - `let a: float32x4 = 1` is the
 * design's own first example and would otherwise have been the one case left
 * refused.
 */


test('a lane value broadcasts where the runtime decides the type', () => {
  expect(evaluated('let s: any = 2; let b: float32x4 = s; String(b);')).toBe('(2, 2, 2, 2)');
  expect(evaluated('let s: any = 2; let b: float32x4 = s; String(Reflect.typeOf(b) === float32x4);')).toBe('true');
  // A value that is not a conversion source for the lane type is still refused.
  expect(ok('let s: any = "x"; let b: float32x4 = s;')).toBe(false);
});


/**
 * The bit-vector conversion, #sec-vector-lanes: "lane i of a
 * `vector.<uint.<1>, N>` is bit i of an N-bit integer, counting from the least
 * significant", and the conversion is that correspondence read in EACH
 * direction.
 *
 * It is answered before the broadcast because it is the more specific rule. A
 * `uint.<1>` is itself a lane type, so `boolean8 = 2` would otherwise try to
 * broadcast 2 into every lane - and 2 is not a value of `uint.<1>`, so it would
 * then be refused rather than read as bits.
 */

test('an integer converts to a bit vector by its bits', () => {
  // simd.md's own example, verbatim.
  expect(evaluated('let a: boolean8 = 0b00000010; String(a[1]);')).toBe('1');
  expect(evaluated('let a: boolean8 = 0b00000010; String(a[0]);')).toBe('0');
  expect(evaluated('let a: boolean8 = 0b00000010; String(a);')).toBe('(0, 1, 0, 0, 0, 0, 0, 0)');
});

test('a bit vector converts back to an integer', () => {
  // The rest of simd.md's example: set lane 3 and read the value back, which
  // the design writes as 0b00001010.
  expect(evaluated('let a: boolean8 = 0b00000010; a[3] = 1; let n: uint8 = a; String(n);')).toBe('10');
  expect(evaluated('let a: boolean8 = 0; a[0] = 1; a[7] = 1; let n: uint8 = a; String(n);')).toBe('129');
});

test('the bit conversion does not disturb an ordinary broadcast', () => {
  // A vector whose lane type is not `uint.<1>` still broadcasts, which is the
  // assertion that would fail if the bit rule were matched too widely.
  expect(evaluated('let b: float32x4 = 2; String(b);')).toBe('(2, 2, 2, 2)');
  expect(evaluated('let b: int32x4 = 7; String(b);')).toBe('(7, 7, 7, 7)');
});

/**
 * PLAN-simd-engine.md phase 3: permutation, #sec-vector-permutation.
 *
 * `swizzle` names a lane of the receiver for each lane of its result;
 * `shuffle` draws from two sources, where an index below N selects the
 * receiver's lane and an index from N to 2N-1 selects lane I-N of the other.
 *
 * The rule a reader will not guess is that the result's lane count is the
 * NUMBER OF INDICES rather than the receiver's, so a permutation narrows and
 * widens as readily as it reorders. Both are asserted below, on the TYPE as
 * well as the value.
 */

test('swizzle reorders, repeats, narrows, and widens', () => {
  const P = 'const a = float32x4(1, 2, 3, 4); ';
  expect(evaluated(`${P}String(a.swizzle.<3, 2, 1, 0>());`)).toBe('(4, 3, 2, 1)');
  expect(evaluated(`${P}String(a.swizzle.<0, 0, 0, 0>());`)).toBe('(1, 1, 1, 1)');
  expect(evaluated(`${P}String(a.swizzle.<0, 1>());`)).toBe('(1, 2)');
  expect(evaluated(`${P}String(a.swizzle.<0, 1, 0, 1, 0, 1>());`)).toBe('(1, 2, 1, 2, 1, 2)');
});

test('a permutation has the lane count of its index list', () => {
  // The TYPE, not only the values: a narrowing swizzle of a four-lane vector is
  // a two-lane type, and a four-lane annotation refuses it.
  const P = 'const a = float32x4(1, 2, 3, 4); type F2 = vector.<float32, 2>; ';
  expect(evaluated(`${P}String(Reflect.typeOf(a.swizzle.<0, 1>()) === F2);`)).toBe('true');
  expect(evaluated(`${P}const n: F2 = a.swizzle.<0, 1>(); String(n);`)).toBe('(1, 2)');
  expect(ok(`${P}const n: float32x4 = a.swizzle.<0, 1>();`)).toBe(false);
});

test('shuffle draws from two sources', () => {
  // The numbering is where a reader errs, so the case that distinguishes it is
  // asserted: 0 and 1 name the receiver, 4 and 5 name the other's first two.
  const P = 'const a = float32x4(1, 2, 3, 4); const b = float32x4(5, 6, 7, 8); ';
  expect(evaluated(`${P}String(a.shuffle.<0, 1, 4, 5>(b));`)).toBe('(1, 2, 5, 6)');
  expect(evaluated(`${P}String(a.shuffle.<4, 5, 6, 7>(b));`)).toBe('(5, 6, 7, 8)');
});

test('an out-of-range index is refused before the program runs', () => {
  // A type error, as with `lane.<I>()`: the indices are compile-time constants.
  // The bound is N for swizzle and 2N for shuffle, and both are asserted.
  const P = 'const a = float32x4(1, 2, 3, 4); const b = float32x4(5, 6, 7, 8); ';
  expectThrown(`${P}a.swizzle.<4>();`);
  expectThrown(`${P}a.shuffle.<8>(b);`);
  // 4 is in range for shuffle and not for swizzle, which is the whole
  // difference between the two bounds.
  expect(evaluated(`${P}String(a.shuffle.<4>(b));`)).toBe('(5)');
});

test('a permutation leaves its sources unchanged', () => {
  const P = 'const a = float32x4(1, 2, 3, 4); ';
  expect(evaluated(`${P}a.swizzle.<3, 2, 1, 0>(); String(a);`)).toBe('(1, 2, 3, 4)');
});

test('shuffle requires a source of the receiver type', () => {
  const P = 'const a = float32x4(1, 2, 3, 4); const c = int32x4(1, 2, 3, 4); ';
  expectThrown(`${P}a.shuffle.<0, 4>(c);`);
});

/**
 * PLAN-simd-engine.md phase 4: component accessors,
 * #sec-vector-component-accessors.
 *
 * Five rules decide what an accessor IS - at most four lanes, one to four
 * characters, every character from ONE set, every character's index below the
 * lane count - and two decide what it means: the type is the lane type for one
 * character and an L-lane vector for L, and an accessor naming no lane twice is
 * assignable while one naming a lane twice is not.
 *
 * They desugar to phase 2 and phase 3: `v.x` is `v.lane.<0>()` and `v.xzzw` is
 * `v.swizzle.<0, 2, 2, 3>()`, which is why this phase follows both.
 */

test('the two name sets reach the same lanes', () => {
  const P = 'const v = float32x4(1, 2, 3, 4); ';
  expect(evaluated(`${P}String(v.x);`)).toBe('1');
  expect(evaluated(`${P}String(v.r);`)).toBe('1');
  expect(evaluated(`${P}String(v.wzyx);`)).toBe('(4, 3, 2, 1)');
  expect(evaluated(`${P}String(v.abgr);`)).toBe('(4, 3, 2, 1)');
});

test('an accessor of L characters is an L-lane vector', () => {
  const P = 'const v = float32x4(1, 2, 3, 4); ';
  expect(evaluated(`${P}String(v.xyzw);`)).toBe('(1, 2, 3, 4)');
  expect(evaluated(`${P}String(v.xy);`)).toBe('(1, 2)');
  // A REPEAT reads fine and is the design's own broadcast spelling. Only the
  // ASSIGNMENT is refused, and having both here is what keeps the rule from
  // reading as "repeats are banned".
  expect(evaluated(`${P}String(v.xxxx);`)).toBe('(1, 1, 1, 1)');
});

test('a key that is not an accessor is not one', () => {
  const P = 'const v = float32x4(1, 2, 3, 4); ';
  expectThrown(`${P}v.xr;`);      // mixes the two sets
  expectThrown(`${P}v.xyzwx;`);   // five characters
  expectThrown(`${P}v.q;`);       // in neither set
});

test('an accessor naming a lane twice cannot be assigned to', () => {
  const P = 'const v = float32x4(1, 2, 3, 4); type F2 = vector.<float32, 2>; '
    + 'const w: F2 = float32x4(9, 8, 0, 0).swizzle.<0, 1>(); ';
  expect(evaluated(`${P}v.x = 9; String(v);`)).toBe('(9, 2, 3, 4)');
  expect(evaluated(`${P}v.xy = w; String(v);`)).toBe('(9, 8, 3, 4)');
  expectThrown(`${P}v.xx = w;`);
});

test('a computed accessor reaches the same value', () => {
  // The first of the observability assertions: accessors are PROPERTIES, so a
  // computed access reaches them. `Reflect.get`, `in`, and `Object.keys` need
  // a wrapper object this engine does not build for a vector - see below.
  const P = 'const v = float32x4(1, 2, 3, 4); ';
  expect(evaluated(`${P}String(v["xyz"]);`)).toBe('(1, 2, 3)');
  expect(evaluated(`${P}String(v["x"]);`)).toBe('1');
});

/**
 * The reflection half of "properties, not syntax", and what it found in the
 * clause.
 *
 * A vector boxes to an exotic object that COMPUTES its accessors from the
 * receiver's lane count, so `Object.keys(v)` is empty and
 * `Object.getOwnPropertyNames(v)` is the 680 names the clause counts. Both were
 * a host crash before.
 *
 * TWO OF THE CLAUSE'S FOUR ASSERTIONS ARE WRONG ABOUT JAVASCRIPT, and a string
 * shows it: `'0' in 'abc'` and `Reflect.get('abc', '0')` both throw, because
 * `in` and `Reflect.get` require an actual Object and a string is a primitive.
 * A vector is a primitive too, so `'xyz' in v` and `Reflect.get(v, 'wzyx')`
 * cannot hold however the accessors are implemented - the clause is asking for
 * behaviour the language does not give any primitive.
 *
 * The two that CAN hold do: `v['xyz']` reaches the accessor, and reflection
 * over the boxed object sees the names.
 */

test('a vector boxes to an object carrying its accessors', () => {
  const P = 'const v = float32x4(1, 2, 3, 4); ';
  // Empty, because the accessors are non-enumerable - which is what the clause
  // requires and what would fail if they were own data properties.
  expect(evaluated(`${P}String(Object.keys(v).length);`)).toBe('0');
  // The clause's own count, for a four-lane vector: two sets over lengths one
  // to four is 2 * (4 + 16 + 64 + 256).
  expect(evaluated(`${P}String(Object.getOwnPropertyNames(v).length);`)).toBe('680');
  expect(evaluated(`${P}String(Object.getOwnPropertyNames(v).includes("xyzw"));`)).toBe('true');
  expect(evaluated(`${P}String(Object.getOwnPropertyNames(v).includes("abgr"));`)).toBe('true');
});

test('a two-lane vector has only the accessors it can have', () => {
  // The rule a SHARED prototype could not express: `z` is an accessor of a
  // four-lane vector and not of a two-lane one, and the wrapper computes from
  // the receiver rather than storing a fixed set.
  const P = 'const p = float32x4(1, 2, 3, 4).swizzle.<0, 1>(); ';
  expect(evaluated(`${P}String(Object.getOwnPropertyNames(p).includes("z"));`)).toBe('false');
  expect(evaluated(`${P}String(Object.getOwnPropertyNames(p).includes("xy"));`)).toBe('true');
});

test('`in` and Reflect.get refuse a vector as they refuse a string', () => {
  // Not a gap in the wrapper: both operations require an Object, and a vector
  // is a primitive. The same expressions on a string throw identically.
  expectThrown('const v = float32x4(1, 2, 3, 4); "xyz" in v;');
  expectThrown('"0" in "abc";');
  expectThrown('const v = float32x4(1, 2, 3, 4); Reflect.get(v, "wzyx");');
  expectThrown('Reflect.get("abc", "0");');
});

/**
 * PLAN-simd-engine.md phases 4b and 5: lane-wise arithmetic, comparisons, and
 * the operations that consume a mask.
 *
 * Arithmetic is what the rest of the surface is FOR - the design's own dot
 * product is `(a * b).sum()`, so an engine with swizzle and sum and no `*`
 * cannot run the example that motivates sum.
 */

test('an operator over two vectors applies lane-wise', () => {
  const P = 'const a = float32x4(1, 2, 3, 4); const b = float32x4(5, 6, 7, 8); ';
  expect(evaluated(`${P}String(a + b);`)).toBe('(6, 8, 10, 12)');
  expect(evaluated(`${P}String(a * b);`)).toBe('(5, 12, 21, 32)');
  expect(evaluated(`${P}String(b - a);`)).toBe('(4, 4, 4, 4)');
  // The design's dot product, verbatim.
  expect(evaluated(`${P}String((a * b).sum());`)).toBe('70');
});

test('vectors of different shapes are not operands of one operator', () => {
  const P = 'const a = float32x4(1, 2, 3, 4); const c = int32x4(1, 2, 3, 4); ';
  expectThrown(`${P}a + c;`);
});

test('a comparison yields one mask lane per input lane', () => {
  // simd.md's own example: (true, true, false, false), which is the bit vector
  // (1, 1, 0, 0).
  const P = 'type Mask = vector.<uint.<1>, 4>; const a = float32x4(1, 2, 3, 4); const b = float32x4(4, 3, 2, 1); ';
  expect(evaluated(`${P}const r: Mask = a < b; String(r);`)).toBe('(1, 1, 0, 0)');
  expect(evaluated(`${P}const r: Mask = a > b; String(r);`)).toBe('(0, 0, 1, 1)');
});

test('a mask reduces to a boolean', () => {
  const P = 'type Mask = vector.<uint.<1>, 4>; const a = float32x4(1, 2, 3, 4); const b = float32x4(4, 3, 2, 1); const m: Mask = a < b; ';
  expect(evaluated(`${P}String(m.any());`)).toBe('true');
  expect(evaluated(`${P}String(m.all());`)).toBe('false');
  expect(evaluated('type Mask = vector.<uint.<1>, 4>; const m: Mask = float32x4(1,1,1,1) < float32x4(2,2,2,2); String(m.all());')).toBe('true');
  expect(evaluated('type Mask = vector.<uint.<1>, 4>; const m: Mask = float32x4(9,9,9,9) < float32x4(2,2,2,2); String(m.any());')).toBe('false');
});

test('select chooses lane-wise and evaluates both arguments', () => {
  const P = 'type Mask = vector.<uint.<1>, 4>; const a = float32x4(1, 2, 3, 4); const b = float32x4(4, 3, 2, 1); const m: Mask = a < b; ';
  expect(evaluated(`${P}String(m.select(a, b));`)).toBe('(1, 2, 2, 1)');

  // BOTH arguments are evaluated, because select is a call and not a
  // conditional - the trade the operation exists to make, and only observable
  // through a side effect.
  expect(evaluated(`${P}let n = 0; const f = () => { n = n + 1; return a; }; m.select(f(), f()); String(n);`)).toBe('2');
});

test("select's element type is independent of the mask's", () => {
  // U is not the receiver's lane type: a mask selects between vectors of any
  // lane type sharing its lane count. A float mask selecting int vectors is the
  // case that would fail if U were tied to the mask.
  const P = 'type Mask = vector.<uint.<1>, 4>; const m: Mask = float32x4(1, 2, 3, 4) < float32x4(4, 3, 2, 1); ';
  expect(evaluated(`${P}String(m.select(int32x4(9, 9, 9, 9), int32x4(1, 1, 1, 1)));`)).toBe('(9, 9, 1, 1)');
});

test('a mask is an ordinary vector', () => {
  // It indexes, permutes, and carries component accessors like any other, which
  // follows from the earlier phases rather than needing a rule.
  const P = 'type Mask = vector.<uint.<1>, 4>; const m: Mask = float32x4(1, 2, 3, 4) < float32x4(4, 3, 2, 1); ';
  expect(evaluated(`${P}String(m.x);`)).toBe('1');
  expect(evaluated(`${P}String(m[2]);`)).toBe('0');
  expect(evaluated(`${P}String(m.xyxy);`)).toBe('(1, 1, 1, 1)');
});

/**
 * PLAN-simd-engine.md phase 6: wrapping, #sec-vector-wrapping.
 *
 * The clause adds no rule - it states a consequence of the ones for aliases and
 * classes, and is stated because it decides a design question simd.md poses. A
 * math library's `Vector4` is an alias or a class, and component accessors
 * decide which.
 */

test('an alias of a vector type has its accessors and a wrapping class does not', () => {
  // An alias IS the vector type, so it has everything a vector has.
  expect(evaluated('type V4 = float32x4; const v: V4 = float32x4(1, 2, 3, 4); String(v.x);')).toBe('1');
  expect(evaluated('type V4 = float32x4; const v: V4 = float32x4(1, 2, 3, 4); String(v.xy);')).toBe('(1, 2)');

  // A class holding one is a distinct nominal type and does not acquire the
  // members of its field's type. The field itself is reached by name.
  const C = 'class W { v: float32x4 = float32x4(1, 2, 3, 4); } const w = new W(); ';
  expect(evaluated(`${C}String(w.v);`)).toBe('(1, 2, 3, 4)');
  expect(evaluated(`${C}String(w.v.x);`)).toBe('1');
  expect(evaluated(`${C}String(w.x);`)).toBe('undefined');
});

/**
 * `vector.preferredLanes(T)` is NOT implemented, and the reason is a CONVENTION
 * rather than a gap - which is a correction to what an earlier note here said.
 *
 * `vector` is not a binding, so there is no base to read the property from. The
 * earlier note called that an anomaly, on the grounds that a type is a value in
 * this design. Measured, it is the rule: `typeof uint` and `typeof int` are
 * `undefined` too, because builtinTypeRecord answers null for a bare
 * parameterized primitive and a record only for an applied one. `vector`
 * behaves exactly as its four siblings do, and binding it alone would make it
 * the odd one out.
 *
 * So reaching the operation means either binding all five - a design change
 * nothing asks for - or giving preferredLanes a home that does not need
 * `vector` to be a value. The second is a decision sec-vector-widths has not
 * made, and it is the real blocker.
 */

test('a bare parameterized primitive is not a value', () => {
  // The convention the note above describes, asserted so that a later change
  // to it is deliberate rather than accidental.
  expect(evaluated('String(typeof uint);')).toBe('undefined');
  expect(evaluated('String(typeof int);')).toBe('undefined');
  expect(evaluated('String(typeof vector);')).toBe('undefined');
  // While an APPLIED one is.
  expect(evaluated('String(typeof uint8);')).toBe('object');
  expect(evaluated('String(typeof float32x4);')).toBe('object');
});

/**
 * The comparison result forms: one of the clause's three now lands, and the
 * remaining divergence is narrowed to a single case.
 *
 * sec-vector-comparisons gives a comparison three result forms chosen by the
 * expected type: the WIDE MASK, a vector of the boolean type of the compared
 * element's width; the COMPACT MASK, a bit vector of one bit per lane; and the
 * compared vector type itself with matching lanes all-ones.
 *
 * The wide mask now works where a binding annotation supplies the expected
 * type, because the CONVERSION from the compact form to it is a rule about two
 * vector types and needs nothing from the selection machinery. `const m:
 * boolean32x4 = a < b` yields four 32-bit lanes, all-set where the comparison
 * held.
 *
 * WHAT REMAINS is the clause's ambiguity rule: "left with no expected type the
 * expression is ambiguous among them and is a type error". A bare `a < b` is
 * accepted here and yields the compact mask. Making it an error needs the
 * selection to be a real overload resolution rather than a conversion, which
 * needs sec-overloading-on-return-type - and `overloads.mts` resolves on
 * ARGUMENT types, so a function overloaded only on its return type does not
 * even parse.
 *
 * So the divergence is one case rather than two, and the test says which.
 */

test('an annotated comparison yields the wide mask', () => {
  const P = 'const a = float32x4(1, 2, 3, 4); const b = float32x4(4, 3, 2, 1); '
    + 'const m: boolean32x4 = a < b; ';
  expect(evaluated(`${P}String(Reflect.typeOf(m) === boolean32x4);`)).toBe('true');
  // All-set where the comparison held, all-clear where it did not - asserted at
  // both ends of a lane, since a partial fill would pass a first-bit check.
  expect(evaluated(`${P}String(m[0][0]);`)).toBe('1');
  expect(evaluated(`${P}String(m[0][31]);`)).toBe('1');
  expect(evaluated(`${P}String(m[2][0]);`)).toBe('0');
  expect(evaluated(`${P}String(m[2][31]);`)).toBe('0');
});

test('an unannotated comparison is a type error', () => {
  // The clause makes this a type error, since nothing selects among the three
  // forms. The engine accepts it and yields the compact mask. Asserted as it
  // behaves with the divergence named above, so the test flips when
  // return-type overloading lands rather than sitting red until then.
  const P = 'const a = float32x4(1, 2, 3, 4); const b = float32x4(4, 3, 2, 1); ';
  expect(ok(`${P}a < b;`)).toBe(false);
});

/**
 * PLAN-simd-engine.md phase 7: the interactions.
 *
 * A vector meets the rest of the language wherever a value type does, and these
 * are the places the plan named. Most needed nothing - the earlier phases gave
 * a vector everything it needs to be an ordinary value - which is the useful
 * result rather than a disappointing one.
 */

test('a vector is an ordinary array element and loop variable', () => {
  const P = 'const xs: [].<float32x4> = [float32x4(1, 2, 3, 4)]; ';
  expect(evaluated(`${P}String(xs[0]);`)).toBe('(1, 2, 3, 4)');
  expect(evaluated(`${P}let s = ""; for (const v of xs) { s = String(v); } s;`)).toBe('(1, 2, 3, 4)');
  expect(evaluated(`${P}String(xs[0].x);`)).toBe('1');
});

test('a vector carries its type through the pipeline', () => {
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a |> %.swizzle.<1, 0>());')).toBe('(2, 1)');
  expect(evaluated('const a = float32x4(1, 2, 3, 4); String(a |> %.sum());')).toBe('10');
});

test('a vector is not iterable', () => {
  // simd.md gives lanes an index and a permutation and no iterator, so
  // destructuring and spreading REPORT rather than succeeding. They crashed the
  // host before, because the refusal boxed through ToObject - which asserts on
  // a vector - where a typed number in the same position already reported.
  expectThrown('const [p, q] = float32x4(1, 2, 3, 4);');
  expectThrown('const xs = [...float32x4(1, 2, 3, 4)];');
});

/**
 * PLAN-simd-engine.md phase 6b: simd.md's Instructions table, as a checklist.
 *
 * That table lists eleven expressions against their x86 and AArch64 encodings.
 * It is informative - this engine compiles none of them - but it is the
 * DESIGN'S OWN ENUMERATION of what a vector is for, so every row should run.
 * All eleven do.
 *
 * Reading it as a checklist rather than as prose is what found lane-wise
 * arithmetic missing from the plan entirely, and `v.xxxx` missing from phase 4.
 */

test("every expression in the design's instruction table runs", () => {
  const P = 'const v = float32x4(1, 2, 3, 4); const w = float32x4(5, 6, 7, 8); ';
  expect(evaluated(`${P}String(v.lane.<0>());`)).toBe('1');                       // extractps
  expect(evaluated(`${P}let i = 1; String(v[i]);`)).toBe('2');                    // variable permute
  expect(evaluated(`${P}String(v.withLane.<0>(9));`)).toBe('(9, 2, 3, 4)');       // insertps
  expect(evaluated(`${P}String(v.xxxx);`)).toBe('(1, 1, 1, 1)');                  // shufps / vbroadcastss
  expect(evaluated(`${P}String(v.wzyx);`)).toBe('(4, 3, 2, 1)');                  // shufps
  expect(evaluated(`${P}String(v.shuffle.<0, 1, 4, 5>(w));`)).toBe('(1, 2, 5, 6)'); // shufps / zip1
  expect(evaluated(`${P}const p = w.swizzle.<0, 1>(); v.xy = p; String(v);`)).toBe('(5, 6, 3, 4)'); // blendps
  expect(evaluated(`${P}type Mask = vector.<uint.<1>, 4>; const r: Mask = v < w; String(r);`)).toBe('(1, 1, 1, 1)'); // cmpltps
  expect(evaluated(`${P}type Mask = vector.<uint.<1>, 4>; const m: Mask = v < w; String(m.select(v, w));`)).toBe('(1, 2, 3, 4)'); // blendvps
  expect(evaluated(`${P}type Mask = vector.<uint.<1>, 4>; const m: Mask = v < w; String(m.all());`)).toBe('true'); // movmskps + cmp
  expect(evaluated(`${P}type Mask = vector.<uint.<1>, 4>; const m: Mask = v < w; String(m.any());`)).toBe('true'); // movmskps + test
});
