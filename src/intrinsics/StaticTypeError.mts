import { Value, UndefinedValue, type Arguments, type FunctionCallContext } from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { captureStack } from '../utils/stack.mts';
import { setErrorHostInternalSlot } from './Error.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import { ErrorHostInternalSlots, type ErrorObject } from './Error.mts';
import { surroundingAgent } from '#self';
import {
  CreateNonEnumerableDataPropertyOrThrow,
  InstallErrorCause,
  OrdinaryCreateFromConstructor,
  ToString,
  type FunctionObject,
} from '../abstract-ops/all.mts';
import type { Realm } from '#self';

/**
 * proposal-runtime-types #sec-type-errors: the error a DECIDABLE type violation
 * produces.
 *
 * The clause makes such a violation an Early Error - "a source text that
 * contains one is rejected rather than evaluated" - and "reserves a thrown
 * *TypeError* for the ~any~ boundary and other genuinely dynamic checks". It
 * does not say what the rejection throws, and that is the gap this fills.
 *
 * WHY NOT `TypeError`: that is the one this must be distinguishable FROM. A
 * `TypeError` can be caught where it occurs; an Early Error rejects the source
 * text before any of it runs. Using one constructor for both meant a program
 * could not tell which it had, which is the split this exists for.
 *
 * WHY NOT `SyntaxError`: every Early Error in ECMA-262 is one, so reusing it is
 * the obvious move, and the argument for it is that a loader treating a
 * `SyntaxError` as "this source did not load" would keep working unchanged.
 * Measured, that argument does not hold: Node's ESM loader, its module
 * translators and its CJS loader make no reference to `SyntaxError`; its REPL
 * branches on `e.name === 'SyntaxError'`, which this fails under any parent;
 * and Vite's config loader guards its `instanceof SyntaxError` with a message
 * test no type error satisfies. Inheriting would have bought nothing real while
 * costing something real - every existing `catch (e instanceof SyntaxError)`
 * would silently begin catching type errors, and the syntax is impeccable in
 * every program this refuses.
 *
 * WHY IT EXTENDS `Error` DIRECTLY: it is what every native ECMAScript error
 * does - `TypeError`, `SyntaxError`, `RangeError` and the rest all sit flat
 * under `Error`, and none subclasses another - and it is what
 * `WebAssembly.CompileError` does, which is the same idea in a neighbouring
 * language surface: a module that decodes cleanly and then fails VALIDATION
 * gets its own class, directly under `Error`, rather than being folded into the
 * decode failure.
 *
 * A program that wants both phases writes
 * `e instanceof StaticTypeError || e instanceof TypeError`; both constructors
 * are globals, and the two are disjoint by construction, which is the point.
 */
function* StaticTypeErrorConstructor([message = Value.undefined, options = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  let newTarget;
  if (NewTarget instanceof UndefinedValue) {
    newTarget = surroundingAgent.activeFunctionObject;
  } else {
    newTarget = NewTarget;
  }
  const O = Q(yield* OrdinaryCreateFromConstructor(newTarget as FunctionObject, '%StaticTypeError.prototype%', [
    'ErrorData',
    ...ErrorHostInternalSlots,
  ])) as ErrorObject;
  if (message !== Value.undefined) {
    const msg = Q(yield* ToString(message));
    X(CreateNonEnumerableDataPropertyOrThrow(O, Value('message'), msg));
  }
  Q(yield* InstallErrorCause(O, options));
  Q(yield* setErrorHostInternalSlot(O, captureStack()));
  return O;
}

export function bootstrapStaticTypeError(realmRec: Realm) {
  const c = bootstrapConstructor(realmRec, StaticTypeErrorConstructor, 'StaticTypeError', 1, realmRec.Intrinsics['%StaticTypeError.prototype%'] as never, []);
  // The CONSTRUCTOR's prototype is `%Error%`, matching the prototype chain of
  // the instances and of every native error constructor.
  c.Prototype = realmRec.Intrinsics['%Error%'];
  realmRec.Intrinsics['%StaticTypeError%'] = c;
}
