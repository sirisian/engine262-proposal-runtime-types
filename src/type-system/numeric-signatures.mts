/**
 * proposal-runtime-types, table-numeric-library-signatures: the listing itself,
 * held once so the two consumers cannot drift. The runtime dispatch
 * (src/intrinsics/Math.mts) selects a row from the argument types and applies
 * its return rule; the static checker (src/type-system/check.mts) resolves the
 * same listing per #sec-overload-resolution, with the contextual type
 * (#sec-contextual-types) filtering signatures whose return is not assignable
 * to it, and records the resolution for the call evaluation to honour. The
 * listing is data; everything behavioural stays with its phase.
 */

/**
 * The row a function has at the integer family. Every other listed function has
 * no integer row, which is `undefined` here and is a type error at a typed
 * call.
 */
export type IntegerRow =
  /** The exact result, checked at T: abs, sign, min, max, pow. */
  | 'checked'
  /** The argument unchanged: floor, ceil, round, trunc. */
  | 'identity'
  /** The integer root truncated toward zero: sqrt, cbrt. */
  | 'root'
  /** N less the bit length of the value modulo 2**N, checked at T: clz32, clz. */
  | 'leadingZeros'
  /** The low 32 bits of the product as an int32, whatever T the arguments carry. */
  | 'imul';

/** The rows of <emu-xref href="#table-numeric-library-signatures">, by function name. */
export const numericLibraryRows: ReadonlyMap<string, { integer?: IntegerRow, float: boolean }> = new Map([
  ['abs', { integer: 'checked' as IntegerRow, float: true }],
  ['sign', { integer: 'checked' as IntegerRow, float: true }],
  ['min', { integer: 'checked' as IntegerRow, float: true }],
  ['max', { integer: 'checked' as IntegerRow, float: true }],
  ['pow', { integer: 'checked' as IntegerRow, float: true }],
  ['floor', { integer: 'identity' as IntegerRow, float: true }],
  ['ceil', { integer: 'identity' as IntegerRow, float: true }],
  ['round', { integer: 'identity' as IntegerRow, float: true }],
  ['trunc', { integer: 'identity' as IntegerRow, float: true }],
  ['sqrt', { integer: 'root' as IntegerRow, float: true }],
  ['cbrt', { integer: 'root' as IntegerRow, float: true }],
  ['clz32', { integer: 'leadingZeros' as IntegerRow, float: false }],
  ['clz', { integer: 'leadingZeros' as IntegerRow, float: false }],
  ['imul', { integer: 'imul' as IntegerRow, float: false }],
  // The transcendentals, the two-argument approximations, and the format and
  // iterable functions: a float row and no integer row.
  ['exp', { float: true }],
  ['expm1', { float: true }],
  ['log', { float: true }],
  ['log1p', { float: true }],
  ['log2', { float: true }],
  ['log10', { float: true }],
  ['sin', { float: true }],
  ['cos', { float: true }],
  ['tan', { float: true }],
  ['asin', { float: true }],
  ['acos', { float: true }],
  ['atan', { float: true }],
  ['sinh', { float: true }],
  ['cosh', { float: true }],
  ['tanh', { float: true }],
  ['asinh', { float: true }],
  ['acosh', { float: true }],
  ['atanh', { float: true }],
  ['atan2', { float: true }],
  ['hypot', { float: true }],
  ['fround', { float: true }],
  ['f16round', { float: true }],
  ['sumPrecise', { float: true }],
]);

export function isIntegerTypeName(name: string): boolean {
  return name === 'int' || name === 'uint';
}

/**
 * proposal-runtime-types #sec-binary-floating-point-types names FOUR binary
 * floating-point types - float16, float32, float64 and float128 - and
 * #table-binary-float-types gives each its width and precision. float128 was
 * left out here while the engine had no values for it, which made a literal at
 * a float128 position unassignable and every conversion into one refuse.
 */
export function isFloatTypeName(name: string): boolean {
  return name === 'float16' || name === 'float32' || name === 'float64' || name === 'float128';
}
