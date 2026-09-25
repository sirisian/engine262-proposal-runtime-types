import { expect, test } from 'vitest';
import { evaluated, expectThrownKind, expectStaticTypeError } from '../harness.mts';

/**
 * float128 as a working binary128 type, end to end.
 *
 * It was a double in an object: every operator fell through to ToNumeric, whose
 * valueOf rounded each operand to 53 bits, and answered a Number. Now each
 * operation of #sec-which-operations-each-family-defines computes exactly and
 * rounds once (Float128Arithmetic, tested bit for bit against gcc in
 * float128-arithmetic.test.mts), and this file checks the language around it.
 * Expected digits are gcc's __float128 where they are not exact.
 */

const Q = (n: number | string) => `(${n} := float128)`;
const show = (e: string) => evaluated(`String(${e});`);
const typed = (e: string) => evaluated(`String(Reflect.typeOf(${e}));`);

test('the operators compute at binary128 and keep the type', () => {
  expect(show(`${Q(1)} / ${Q(3)}`)).toBe('0.3333333333333333333333333333333333'); // gcc: ...333317, shortest form
  for (const op of ['+', '-', '*', '/', '%', '**']) expect(typed(`${Q(7)} ${op} ${Q(2)}`), op).toBe('float128');
  expect(typed(`-${Q(1)}`)).toBe('float128');
  expect(typed(`+${Q(1)}`)).toBe('float128');
  expect(evaluated(`let x = ${Q(1)}; x++; ++x; String(x);`)).toBe('3');
  expect(show(`${Q(2)} ** 10`)).toBe('1024');
  // A non-integer exponent needs a transcendental function: refused until correctly rounded.
  expectThrownKind(`${Q(2)} ** 0.5;`, 'RangeError');
});

test('no implicit conversion: a literal is read at float128, a Number value is refused', () => {
  expect(typed(`${Q(1)} + 1`)).toBe('float128');
  expect(show(`${Q(3)} == 3`)).toBe('true');
  expectThrownKind(`let n = 1; ${Q(1)} + n;`, 'TypeError');
  expectThrownKind(`Math.floor(${Q(3)}) + ${Q(1)}.valueOf();`, 'TypeError');
});

test('equality and order, NaN and the signed zeroes', () => {
  expect(show(`${Q(1)} == ${Q(1)}`)).toBe('true');
  expect(show(`${Q(1)} === ${Q(1)}`)).toBe('true');
  expect(show(`${Q(1)} < ${Q(3)}`)).toBe('true');
  expect(evaluated(`const z = ${Q(0)}; const n = z / z; String([n == n, [n].includes(n), Object.is(-z, z), -z == z]);`))
    .toBe('false,true,false,true');
});

test('literals and named constants are their digits, rounded once to 113 bits', () => {
  expect(evaluated('let v: float128 = 0.1; String(v);')).toBe('0.1');
  // Not the double 0.1 widened, which is what a literal used to be.
  expect(evaluated('let v: float128 = 0.1; String(v == (0.1 := float128));')).toBe('true');
  expect(evaluated('const K = 0.1; let v: float128 = K; String(v == (0.1 := float128));')).toBe('true');
  expect(evaluated('let v: float128 = -0.1; String(-v == (0.1 := float128));')).toBe('true');
});

test('conversions in and out, each rounded once from the exact value', () => {
  const big = '1152921504606846977'; // 2**60 + 1: exact in float128, not in a double
  expect(show(`(BigInt('${big}') := uint64) := float128`)).toBe(big);
  expect(show('(2n ** 60n + 1n) := float128')).toBe(big);
  expect(show(`((2n ** 60n + 1n) := float128) := uint64`)).toBe(big);
  expect(show(`(rational(1, 3) := float128) == ${Q(1)} / ${Q(3)}`)).toBe('true');
  expect(show(`(decimal128('0.1') := float128) == (0.1 := float128)`)).toBe('true');
  expect(show(`(${Q(1)} / ${Q(3)}) := float32`)).toBe('0.3333333432674408');
  expect(show(`${Q(300)} := int8`)).toBe('44');
  expect(show(`(${Q(7)} / ${Q(2)}) := bigint`)).toBe('3');
  expect(show(`${Q(0.5)} := rational`)).toBe('1/2');
  // decimal carries the binary value, as for a double - not one tenth.
  expect(show('decimal128(0.1 := float128)')).toBe('0.1000000000000000000000000000000000');
  expect(show(`decimal128(${Q(0.5)})`)).toBe('0.5');
});

test('C2: implicit use as a Number refuses; the explicit conversion agrees in every spelling', () => {
  for (const [label, x, want] of [
    ['decimal', "decimal64('1.5')", '1.5'],
    ['rational', 'rational(1, 3)', '0.3333333333333333'],
    ['float128', `(${Q(1)} / ${Q(3)})`, '0.3333333333333333'],
  ]) {
    expect(show(`Number(${x})`), label).toBe(want);
    expect(show(`${x} := number`), label).toBe(want);
    expect(show(`float64(${x})`), label).toBe(want);
  }
  expectThrownKind('Number(3 := complex64);', 'TypeError');
  expect(show('(2n ** 64n) := number')).toBe('18446744073709552000');
  expect(show('(2n ** 2000n) := number')).toBe('Infinity');
  expectThrownKind(`Math.floor(${Q(3)}) + 1n;`, 'TypeError');
});

test('Math: exact, correctly rounded, or refused by name', () => {
  expect(show(`Math.sqrt(${Q(2)})`)).toBe('1.414213562373095048801688724209698'); // gcc sqrtq
  expect(show(`Math.hypot(${Q(3)}, ${Q(4)})`)).toBe('5');
  expect(show(`Math.cbrt(${Q(-27)})`)).toBe('-3');
  expect(typed(`Math.sqrt(${Q(2)})`)).toBe('float128');
  expect(evaluated(`String([Math.floor(${Q(-2.5)}), Math.round(${Q(2.5)}), Math.round(${Q(-2.5)}), Math.trunc(${Q(-2.7)}), Math.abs(${Q(-3)}), Math.sign(${Q(-2)}), Math.max(${Q(1)}, ${Q(3)})]);`))
    .toBe('-3,3,-2,-2,3,-1,3');
  expect(evaluated(`String([Object.is(Math.ceil(${Q(-0.5)}), -${Q(0)}), Object.is(Math.min(${Q(0)}, -${Q(0)}), -${Q(0)})]);`)).toBe('true,true');
  // "The value rounded through binary32 or binary16, a value of T": a float128
  // holding binary32's value exactly, printed at binary128's precision.
  expect(show(`Math.fround(${Q(1)} / ${Q(3)})`)).toBe('0.3333333432674407958984375');
  expect(typed(`Math.fround(${Q(1)} / ${Q(3)})`)).toBe('float128');
  expect(show(`Math.f16round(${Q(1)} / ${Q(3)})`)).toBe('0.333251953125');
  expectThrownKind(`Math.sin(${Q(1)});`, 'RangeError');
  expectStaticTypeError(`Math.clz32(${Q(1)});`);
  expectThrownKind(`let n = 1; Math.max(${Q(1)}, n);`, 'TypeError');
});

test('toString is the shortest decimal that reads back, laid out as a Number is', () => {
  expect(show('0.1 := float128')).toBe('0.1');
  expect(show(`${Q(2)} / ${Q(3)}`)).toBe('0.6666666666666666666666666666666666'); // the nearer 34 digits to 0.666...63457
  expect(show('1e21 := float128')).toBe('1e+21');
  expect(show('1e20 := float128')).toBe('100000000000000000000');
  expect(show('1e-7 := float128')).toBe('1e-7');
  expect(show(`-${Q(0)}`)).toBe('0');
});

test('the numeric predicates answer from the value', () => {
  expect(evaluated(`String([isNaN(${Q(0)} / ${Q(0)}), isFinite(${Q(1)} / ${Q(3)}), Number.isInteger(${Q(3)}), Number.isInteger(${Q(1)} / ${Q(3)}), Number.isSafeInteger((2n ** 60n + 1n) := float128)]);`))
    .toBe('true,true,true,false,false');
});

test('a literal beside a float128 in a Math call takes its type, as beside an operator', () => {
  // #sec-literal-overload-ranking: the literal takes the chosen parameter's type.
  expect(show(`Math.pow(${Q(3)}, 2)`)).toBe('9');
  expect(typed(`Math.pow(${Q(3)}, 2)`)).toBe('float128');
  expect(show(`Math.hypot(${Q(3)}, 4)`)).toBe('5');
  expect(show(`Math.max(${Q(0.5)}, 1)`)).toBe('1');
  // The other object-represented types take it the same way.
  expect(evaluated("String(Math.max(decimal64('0.5'), 1));")).toBe('1');
  expect(evaluated('String(Math.max(rational(1, 2), 1));')).toBe('1');
  // A Number VALUE is still refused - only a literal is adopted.
  expectThrownKind(`let n = 1; Math.max(${Q(0.5)}, n);`, 'TypeError');
});

test('an enum over float128 counts in the type', () => {
  // #sec-enums: a later enumerator takes the prefix increment of the one before;
  // a float128 declares one, so it counts - and in the type, not in doubles.
  expect(evaluated('enum E: float128 { A = 1, B, C } String([E.B, E.C]);')).toBe('2,3');
  expect(evaluated('enum E: float128 { A = 0.5, B } String(E.B);')).toBe('1.5');
  expect(evaluated('enum E: float128 { A = 1, B } String(E.B + (1 := float128));')).toBe('3');
});

test('Math.sumPrecise: the exact sum, rounded once to float128', () => {
  expect(show(`Math.sumPrecise([${Q('1e30')}, ${Q(1)}, -${Q('1e30')}])`)).toBe('1');
  expect(typed(`Math.sumPrecise([${Q(1)}, ${Q(2)}])`)).toBe('float128');
  expect(evaluated(`String(Object.is(Math.sumPrecise([-${Q(0)}, -${Q(0)}]), -${Q(0)}));`)).toBe('true');
  expect(evaluated(`String(Object.is(Math.sumPrecise([${Q(1)}, -${Q(1)}]), ${Q(0)}));`)).toBe('true');
  expect(evaluated(`String(isNaN(Math.sumPrecise([${Q(1)} / ${Q(0)}, -${Q(1)} / ${Q(0)}])));`)).toBe('true');
  expectThrownKind(`Math.sumPrecise([${Q(1)}, 1]);`, 'TypeError');
  expectThrownKind(`Math.sumPrecise([1, ${Q(1)}]);`, 'TypeError');
  expect(evaluated('String(Math.sumPrecise([1e20, 0.1, -1e20]));')).toBe('0.1');
});
