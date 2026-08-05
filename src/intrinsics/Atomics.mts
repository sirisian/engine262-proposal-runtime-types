import {
  Assert,
  Get,
  GetValue,
  OrdinaryObjectCreate,
  PutValue,
  Q,
  ReferenceValue,
  SameValueZero,
  Throw,
  Value,
  X,
  NumberValue,
  type Arguments,
  type ValueEvaluator,
  type PlainEvaluator,
} from '#self';
import type { Realm } from '../execution-context/Realm.mts';
import { assignProps } from './bootstrap.mts';
import { RuntimeTypeOf } from '../type-system/runtime.mts';
import { ConvertValue } from '../abstract-ops/runtime-types.mts';
import { displayType, type TypeRecord } from '../type-system/records.mts';
import { isFloatTypeName, isIntegerTypeName } from '../type-system/numeric-signatures.mts';

/**
 * proposal-runtime-types #sec-threading-atomics.
 *
 * The Atomics operations of the pinned edition take a TypedArray and an index.
 * This clause admits a typed binding reached through a reference, so a program
 * holding a `uint32` may operate on it atomically without first arranging for it
 * to live inside a byte buffer.
 *
 * WHAT IS SIMULATED. In this engine a job runs to completion before any other
 * agent runs, so every operation here is trivially atomic and the seq-cst
 * ordering costs nothing. That is not what these tests are for. What they check
 * is the SURFACE the clause specifies and a real implementation would have to get
 * right anyway: which targets are admitted, which types each operation restricts
 * itself to, that a store passes the typed-storage boundary, that compareExchange
 * compares with SameValueZero, and that the float add is a read-modify-write
 * whose result is the sum. Nothing here demonstrates atomicity, and nothing here
 * could - a simulation with no interleaving below a job boundary has no race to
 * exclude.
 */

interface AtomicTarget {
  readonly Reference: ReferenceValue;
  readonly Type: TypeRecord;
}

/**
 * #sec-validateatomictarget, for the reference shape. The TypedArray shape needs
 * the TypedArray Atomics of the pinned edition, which this engine does not have,
 * and the object-property shape needs the declared type of a typed own data
 * property; both are recorded as not implemented in the test file.
 *
 * The `shared` modifier is NOT consulted. The restrictions are restrictions of
 * type: an integer type where the operation needs bit patterns, and a value type
 * of a size an implementation operates on atomically.
 */
function* ValidateAtomicTarget(args: Arguments, operation: 'integer-only' | 'any-value-type'): PlainEvaluator<AtomicTarget> {
  const first = args[0];
  if (!(first instanceof ReferenceValue)) {
    return Throw.TypeError('$1 is not assignable to $2', first ?? Value.undefined, Value('a reference to typed storage'));
  }
  // The borrow was already validated where the `ref` argument was EVALUATED
  // (RequireBorrowableReference in RefExpression), which is how every `ref`
  // argument reaches every callee. A reference that arrives here has passed it,
  // so re-applying it would be a second check of a settled question - see the
  // note added to #sec-validateatomictarget.
  const current = Q(yield* GetValue(first.Location));
  const type = RuntimeTypeOf(current);
  if (!IsAdmittedValueType(type)) {
    return Throw.TypeError('$1 is not assignable to $2', current, Value('a value type Atomics operates on'));
  }
  if (operation === 'integer-only' && !IsIntegerTyped(type)) {
    return Throw.TypeError('$1 is not assignable to $2', Value(displayType(type)), Value('an integer type'));
  }
  return { Reference: first, Type: type };
}

function IsAdmittedValueType(t: TypeRecord): boolean {
  if (t.Kind === 'shared') {
    return IsAdmittedValueType(t.Target);
  }
  return t.Kind === 'primitive' && (isIntegerTypeName(t.Name) || isFloatTypeName(t.Name));
}

function IsIntegerTyped(t: TypeRecord): boolean {
  if (t.Kind === 'shared') {
    return IsIntegerTyped(t.Target);
  }
  return t.Kind === 'primitive' && isIntegerTypeName(t.Name);
}

/** Read the target. One ReadSharedMemory event of #sec-threading-memory-model. */
function* AtomicRead(target: AtomicTarget): ValueEvaluator {
  return Q(yield* GetValue(target.Reference.Location));
}

/**
 * Write the target. The value passes the typed-storage boundary, so a store of a
 * value not of the target's type throws as an ordinary assignment would and the
 * same conversion applies - which is why this goes through PutValue rather than
 * writing a slot directly.
 */
function* AtomicWrite(target: AtomicTarget, value: Value): PlainEvaluator<void> {
  Q(yield* PutValue(target.Reference.Location, value));
}

function* Atomics_load(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'any-value-type'));
  return Q(yield* AtomicRead(target));
}

function* Atomics_store(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'any-value-type'));
  const value = args[1] ?? Value.undefined;
  Q(yield* AtomicWrite(target, value));
  return value;
}

function* Atomics_exchange(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'any-value-type'));
  const old = Q(yield* AtomicRead(target));
  Q(yield* AtomicWrite(target, args[1] ?? Value.undefined));
  return old;
}

/**
 * #sec-atomics-compare-exchange-predicate: the expected value is compared with
 * the value read using SameValueZero.
 *
 * On an integer target every candidate predicate agrees. On a float target this
 * is the choice that makes a compare-exchange loop terminate: strict equality
 * would retry forever once the observed value is NaN, since NaN is not strictly
 * equal to itself. It also matches -0 to +0, which is the forgiving direction for
 * a sentinel.
 */
function* Atomics_compareExchange(args: Arguments): ValueEvaluator {
  const target = Q(yield* ValidateAtomicTarget(args, 'any-value-type'));
  const expected = args[1] ?? Value.undefined;
  const replacement = args[2] ?? Value.undefined;
  const old = Q(yield* AtomicRead(target));
  // The expected value is converted to the target's type BEFORE it is compared.
  // Without this, `Atomics.compareExchange(ref a, 1, 5)` on a `uint32` compares a
  // typed uint32 against a plain Number and never matches, so every CAS silently
  // fails - which is worse than throwing, since a claim loop would spin. The
  // TypedArray form of the operation does the same conversion for the same
  // reason; the clause now says so.
  const expectedTyped = Q(yield* ConvertValue(expected, target.Type));
  if (SameValueZero(old, expectedTyped)) {
    Q(yield* AtomicWrite(target, replacement));
  }
  return old;
}

function arithmetic(name: string, apply: (a: number, b: number) => number, restriction: 'integer-only' | 'any-value-type') {
  return function* op(args: Arguments): ValueEvaluator {
    const target = Q(yield* ValidateAtomicTarget(args, restriction));
    const operand = args[1] ?? Value.undefined;
    if (!(operand instanceof NumberValue) && !isTypedNumber(operand)) {
      return Throw.TypeError('$1 is not assignable to $2', operand, Value(displayType(target.Type)));
    }
    // #sec-atomics-float-arithmetic: on a float target a real implementation
    // performs this as a seq-cst compare-exchange loop, one attempt being one
    // ReadModifyWriteSharedMemory event. Here a job runs alone, so the loop would
    // succeed on its first attempt every time and is written as the single
    // read-modify-write it degenerates to. The OBSERVABLE result is the same,
    // which is what the surface tests check.
    const old = Q(yield* AtomicRead(target));
    const result = apply(numberOf(old), numberOf(operand));
    Q(yield* AtomicWrite(target, Value(result)));
    return old;
  };
}

function isTypedNumber(value: Value): boolean {
  return 'numberValue' in (value as object);
}

function numberOf(value: Value): number {
  return Number((value as unknown as { numberValue(): number | bigint }).numberValue());
}

export function bootstrapAtomics(realmRec: Realm) {
  const atomics = OrdinaryObjectCreate(realmRec.Intrinsics['%Object.prototype%'], []);
  assignProps(realmRec, atomics, [
    ['load', Atomics_load as never, 1],
    ['store', Atomics_store as never, 2],
    ['exchange', Atomics_exchange as never, 2],
    ['compareExchange', Atomics_compareExchange as never, 3],
    // add and sub take the integers AND the floats; the bitwise operations do
    // not, a bitwise operation on a floating-point value having no meaning the
    // program intended.
    ['add', arithmetic('add', (a, b) => a + b, 'any-value-type') as never, 2],
    ['sub', arithmetic('sub', (a, b) => a - b, 'any-value-type') as never, 2],
    ['and', arithmetic('and', (a, b) => a & b, 'integer-only') as never, 2],
    ['or', arithmetic('or', (a, b) => a | b, 'integer-only') as never, 2],
    ['xor', arithmetic('xor', (a, b) => a ^ b, 'integer-only') as never, 2],
  ]);
  // Every one of these takes its target by reference at position 0
  // (#sec-atomics-reference-arguments), so that position must not decay.
  for (const name of ['load', 'store', 'exchange', 'compareExchange', 'add', 'sub', 'and', 'or', 'xor']) {
    const fn = X(Get(atomics, Value(name)));
    (fn as unknown as { RefParameterIndices: readonly number[] }).RefParameterIndices = [0];
  }
  Assert(atomics !== undefined);
  realmRec.Intrinsics['%Atomics%'] = atomics;
}

export { ValidateAtomicTarget };
