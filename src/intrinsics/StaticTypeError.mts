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
 * produces (OQ27).
 *
 * The clause makes such a violation an Early Error - "a source text that
 * contains one is rejected rather than evaluated" - and "reserves a thrown
 * *TypeError* for the ~any~ boundary and other genuinely dynamic checks". It
 * does not say what the rejection throws, and that is the gap this fills.
 *
 * WHY NOT `SyntaxError`: every Early Error in ECMA-262 is one, and reusing it
 * costs nothing at the loader. But the syntax is impeccable in every program
 * this refuses, and `SyntaxError: "s" is not assignable to "number"` reads as a
 * bug in the engine rather than in the program.
 *
 * WHY NOT `TypeError`: that is the one this must be distinguishable FROM. A
 * `TypeError` can be caught where it occurs; an Early Error rejects the source
 * text before any of it runs. Using one constructor for both meant a program
 * could not tell which it had, which is the split OQ27 was filed for.
 *
 * WHY IT EXTENDS `SyntaxError`: a module loader, a bundler and an `eval` caller
 * all already treat a `SyntaxError` as "this source did not load", and that is
 * exactly what happens here. Subclassing keeps every such path working while
 * letting anything that cares say "this failed TYPE checking" rather than
 * "this failed to parse" - which is what `WebAssembly.CompileError` exists to
 * express for a module that decodes and fails validation.
 *
 * No native ECMAScript error subclasses another, so this is novel FOR
 * JAVASCRIPT; it is ordinary elsewhere, and Python's `IndentationError` is the
 * same pattern for the same reason.
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
  // The CONSTRUCTOR's prototype is `%SyntaxError%`, so
  // `StaticTypeError.__proto__ === SyntaxError` and static inheritance behaves
  // as a subclass declared in the language would.
  c.Prototype = realmRec.Intrinsics['%SyntaxError%'];
  realmRec.Intrinsics['%StaticTypeError%'] = c;
}
