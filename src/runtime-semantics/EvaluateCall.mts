import {
  NumberValue, ObjectValue, ReferenceRecord, ReferenceValue, TypedNumberValue, Value, isTypedNumber,
} from '../value.mts';
import { Q, Completion, AbruptCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import { TakeStaticCallResolution } from '../type-system/check.mts';
import { ArgumentListEvaluation, ArgumentListEvaluationNamed, hasNamedArguments } from './all.mts';
import { signatureInView } from './ArgumentListEvaluation.mts';
import {
  Assert,
  IsPropertyReference,
  IsCallable,
  GetThisValue,
  PrepareForTailCall,
  Call,
  EnvironmentRecord,
  surroundingAgent,
  Throw,
  GetValue,
  R,
} from '#self';
import { pushContextualType, popContextualType } from '../type-system/runtime.mts';
import { soleSignatureParameterTypes } from '../abstract-ops/runtime-types.mts';

/** https://tc39.es/ecma262/#sec-evaluatecall */
export function* EvaluateCall(func: Value, ref: ReferenceRecord | Value, args: ParseNode.TemplateLiteral | ParseNode.Arguments, tailPosition: boolean, callExpression?: ParseNode.CallExpression | ParseNode.OptionalExpression) {
  // 1. If Type(ref) is Reference, then
  let thisValue;
  if (ref instanceof ReferenceRecord) {
    // a. If IsPropertyReference(ref) is true, then
    if (IsPropertyReference(ref) === Value.true) {
      // i. Let thisValue be GetThisValue(ref).
      thisValue = GetThisValue(ref);
    } else {
      // i. Let refEnv be ref.[[Base]].
      const refEnv = ref.Base;
      // ii. Assert: refEnv is an Environment Record.
      Assert(refEnv instanceof EnvironmentRecord);
      // iii. Let thisValue be refEnv.WithBaseObject().
      thisValue = refEnv.WithBaseObject();
    }
  } else {
    // a. Let thisValue be undefined.
    thisValue = Value.undefined;
  }
  // 3. Let argList be ? ArgumentListEvaluation of arguments.
  // proposal-runtime-types: an argument list with named arguments is resolved
  // against the called function's parameter names, so where the syntax is present
  // and the callee is an ordinary function the callability check is taken first
  // and the arguments are mapped to positions. The positional path is unchanged.
  const argsIsNamed = surroundingAgent.feature('runtime-types')
    && Array.isArray(args) && hasNamedArguments(args as ParseNode.Arguments);
  let argList;
  if (!argsIsNamed) {
    // proposal-runtime-types #sec-overloading-on-return-type: "the contextual
    // type of a call is the type its position requires", and an argument
    // position requires the callee's parameter type - "`g(f())` selects the
    // first where `g` takes a `uint32`, because the parameter supplies the
    // contextual type".
    //
    // soleSignatureParameterTypes answers null in the two cases where there is
    // no context to give: an overloaded callee, which is the circularity the
    // clause resolves by rejecting rather than guessing, and a parameter whose
    // type is still a type PARAMETER, which a generic call is about to infer.
    const soleParameterTypes = Q(yield* soleSignatureParameterTypes(func));
    pushContextualType(soleParameterTypes?.[0] ?? null);
    try {
      argList = Q(yield* ArgumentListEvaluation(args));
    } finally {
      popContextualType();
    }
    // proposal-runtime-types #sec-overload-resolution: the checking side
    // resolved this call to a numeric value family from its CONTEXT
    // (TakeStaticCallResolution records only calls whose every argument is a
    // numeric literal proven to fit), so the literal arguments take the chosen
    // parameter type here and the dispatch wrapper of the numeric library
    // selects that family's row. An unrecorded call, the ~any~ path included,
    // dispatches on its runtime argument types exactly as before.
    if (surroundingAgent.feature('runtime-types') && callExpression) {
      const resolved = TakeStaticCallResolution(callExpression);
      if (resolved) {
        argList = argList.map((arg) => (arg instanceof NumberValue && !isTypedNumber(arg)
          ? new TypedNumberValue(wrapToType(R(arg) as number, resolved), resolved)
          : arg)) as typeof argList;
      }
    }
  }
  // 4. If Type(func) is not Object, throw a TypeError exception.
  // 5. If IsCallable(func) is false, throw a TypeError exception.
  if (!(func instanceof ObjectValue) || !IsCallable(func)) {
    if (callExpression) {
      const source = callExpression.sourceText;
      const arg0StartIndex = args.location.startIndex;
      if (source.length < 100) {
        return Throw.TypeError('$1 is not a function. (In "$2", it is $3)', source.slice(0, arg0StartIndex - callExpression.location.startIndex), source, func);
      }
    }
    return Throw.TypeError('$1 is not a function', func);
  }
  if (argsIsNamed) {
    // #sec-call-argument-binding: a named call binds against the SIGNATURE IN
    // VIEW. Where the callee was reached through a reference to a binding whose
    // declared type is a function type or a callable interface, that type's
    // signature is the declaration the call reads - `a(named: 10)` for
    // `a: IExample` maps `named` by the interface's names and fills the skipped
    // position with the interface's default, so `(a, b) => b` receives
    // `('5', 10)`. Without a declared type in view, the callee's own parameter
    // list is read, as before.
    let signature;
    if (ref instanceof ReferenceRecord && ref.Base instanceof EnvironmentRecord) {
      const holder = ref.Base as unknown as { bindings?: { get(n: unknown): { declaredType?: unknown } | undefined }, DeclarativeRecord?: { bindings?: { get(n: unknown): { declaredType?: unknown } | undefined } } };
      const binding = holder.bindings?.get(ref.ReferencedName) ?? holder.DeclarativeRecord?.bindings?.get(ref.ReferencedName);
        if (binding?.declaredType !== undefined) {
        const named = (args as ParseNode.Arguments)
          .filter((a) => (a as { type?: string }).type === 'NamedArgument')
          .map((a) => (a as unknown as { Name: string }).Name);
        signature = signatureInView(binding.declaredType, named);
      }
    }
    argList = Q(yield* ArgumentListEvaluationNamed(args as ParseNode.Arguments, func, signature));
  }
  // 6. If tailPosition is true, perform PrepareForTailCall().
  if (tailPosition) {
    PrepareForTailCall();
  }
  // 7. Let result be Call(func, thisValue, argList).
  const result = yield* Call(func, thisValue, argList);
  // 8. Assert: If tailPosition is true, the above call will not return here but instead
  //    evaluation will continue as if the following return has already occurred.
  // 9. Assert: If result is not an abrupt completion, then Type(result) is an ECMAScript language type.
  if (!(result instanceof AbruptCompletion)) {
    Assert(result instanceof Value || result instanceof Completion);
  }
  // proposal-runtime-types (references extension): a `ref` return decays to
  // the referent's current value at an ordinary call boundary, so a caller
  // that consumes the call as a value observes the referent and never the
  // reference. (Consuming a returned reference as a location is a matter for
  // the assignment-target forms.) The result of Call arrives wrapped in a
  // normal completion from the evaluator, so the check unwraps before it
  // looks; testing the completion object itself made this a dead branch, and
  // a returned reference then reached member bases and typeof raw.
  const callValue = result instanceof Completion ? result.Value : result;
  if (callValue instanceof ReferenceValue && !(result instanceof AbruptCompletion)) {
    // proposal-runtime-types #sec-location-consuming-contexts: a call marked by
    // the parser occupies a position that consumes a LOCATION - the operand of
    // `++`/`--`, or of a `ref` argument - so the reference survives the
    // boundary and the consuming form writes through it. Everywhere else the
    // reference decays here, which is what gives it no observable identity.
    if (callExpression?.type === 'CallExpression' && callExpression.LocationConsuming === true) {
      return callValue;
    }
    return Q(yield* GetValue(callValue.Location));
  }
  // 10. Return result.
  return result;
}
