import { SameType } from '../type-system/relations.mts';
import {
  NumberValue, ObjectValue, ReferenceRecord, ReferenceValue, TypedNumberValue, Value, isTypedNumber,
} from '../value.mts';
import { Q, Completion, AbruptCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { wrapToType } from '../type-system/arithmetic.mts';
import { isTypeObject } from '../type-system/intern.mts';
import { substituteTypeParameters, type TypeRecord } from '../type-system/records.mts';
import { TakeStaticCallResolution, CallReceiverTypeOf, SelfThisTypeRecord } from '../type-system/check.mts';
import { DeclaredReferenceLocationType } from '../abstract-ops/argument-distribution.mts';
import { CallArgumentItems, NamedCallArguments, NamedCallItemsOf } from '../abstract-ops/named-call.mts';
import { DecayReferenceValue } from '../abstract-ops/reference-operations.mts';
import { ArgumentListEvaluation } from './all.mts';
import { signaturesInView, BindCallArgumentItems, ArgumentContexts, parameterInfo } from './ArgumentListEvaluation.mts';
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
  R,
} from '#self';
import { contextualTypeFor, SetPendingCalleeContext, currentTypeParameterFrame, IsOfType } from '../type-system/runtime.mts';
import { soleSignatureParameterTypes } from '../abstract-ops/runtime-types.mts';
import { CopyArgumentResults } from '../type-system/result-dependencies.mts';

/** https://tc39.es/ecma262/#sec-evaluatecall */
export function* EvaluateCall(func: Value, ref: ReferenceRecord | Value, args: ParseNode.TemplateLiteral | ParseNode.Arguments, tailPosition: boolean, callExpression?: ParseNode.CallExpression | ParseNode.OptionalExpression, evaluatedArguments?: readonly Value[]) {
  // The call expression's own position, read before its arguments push theirs.
  const callContext = surroundingAgent.feature('runtime-types') ? contextualTypeFor(callExpression) : undefined;
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
      // proposal-runtime-types #sec-type-object-opacity: "a type may be applied to an
      // argument as `T(v)`", and a type parameter is "a compile-time constant
      // whose value is a type". Its reference names no Environment Record, so
      // the call has no this value: undefined, as for a non-Reference callee
      // (`LengthType(n)` in the binary packet writer asserted).
      if (!(refEnv instanceof EnvironmentRecord)) {
        thisValue = Value.undefined;
      } else {
        // ii. Assert: refEnv is an Environment Record.
        Assert(refEnv instanceof EnvironmentRecord);
        // iii. Let thisValue be refEnv.WithBaseObject().
        thisValue = refEnv.WithBaseObject();
      }
    }
  } else {
    // a. Let thisValue be undefined.
    thisValue = Value.undefined;
  }
  // 3. Let argList be ? ArgumentListEvaluation of arguments.
  // The declared view supplies names/defaults after argument evaluation. Spread
  // mode is selected from each value, never from its expression's syntax.
  let signature: ReturnType<typeof signaturesInView> | undefined;
  if (surroundingAgent.feature('runtime-types') && Array.isArray(args) && ref instanceof ReferenceRecord) {
    // A typed property can carry the same callable view as a lexical binding.
    // Read its declared storage contract without another property Get.
    signature = signaturesInView(DeclaredReferenceLocationType(ref));
  }
  const needsViewDefaults = signature?.length === 1
    && signature[0].Parameters.some((p) => p.Initial !== undefined);
  // proposal-runtime-types #sec-conversions: a call whose callee is a TYPE OBJECT
  // is a conversion, and its argument is evaluated IN that type's context.
  //
  // The runtime has its own contextual-type stack, pushed by a binding
  // declaration, a property definition, a field initializer and a return
  // position - but not by a conversion. So `const a: string = f()` resolved an
  // overloaded `f` at run time and `uint32(f())` did not, though the type is
  // written down in both. The checker learned this separately; this is the other
  // half.
  const conversionContext = surroundingAgent.feature('runtime-types')
    && func instanceof ObjectValue && isTypeObject(func)
    ? (func as { TypeRecord?: TypeRecord }).TypeRecord
    : undefined;
  let argList;
  if (evaluatedArguments) {
    const items = NamedCallItemsOf(evaluatedArguments);
    argList = items ? NamedCallArguments(items) : CopyArgumentResults(evaluatedArguments, [...evaluatedArguments]);
  } else if (conversionContext !== undefined && Array.isArray(args)) {
    // Keyed on the ARGUMENT EXPRESSION, because `contextualTypeFor` is asked for
    // a call node: the inner `f()` in `uint32(f())` looks itself up, not the
    // argument list that holds it.
    const only = (args as readonly ParseNode[])[0];
    argList = Q(yield* ArgumentListEvaluation(args as ParseNode.Arguments, new Map([[only, conversionContext]])));
  } else {
    // Each source expression receives its own statically known parameter
    // destination; no first-parameter context surrounds the entire argument list.
    let contexts: ReadonlyMap<object, TypeRecord> = new Map();
    if (surroundingAgent.feature('runtime-types') && Array.isArray(args)) {
      if (signature?.length === 1) {
        contexts = ArgumentContexts(args, signature[0].Parameters.map((p) => ({ ...p, Type: p.Type as TypeRecord | undefined })));
      } else if (!signature) {
        const types = Q(yield* soleSignatureParameterTypes(func));
        const info = parameterInfo(func);
        if (types) contexts = ArgumentContexts(args, info.names.map((Name, i) => ({ Name, Rest: info.rests[i], Type: types[i] })));
      }
    }
    argList = Q(yield* ArgumentListEvaluation(args, contexts));
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
        argList = CopyArgumentResults(argList, argList.map((arg) => (arg instanceof NumberValue && !isTypedNumber(arg)
          ? new TypedNumberValue(wrapToType(R(arg) as number, resolved), resolved)
          : arg))) as typeof argList;
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
  if (signature && argList) {
    const items = NamedCallItemsOf(argList);
    if (items || needsViewDefaults) {
      argList = Q(yield* BindCallArgumentItems(items ?? CallArgumentItems(argList), func, signature, callContext));
    }
  }
  // #sec-this-adoption: enforce a typed call's receiver view even when the
  // function value reached that view through an erased boundary.
  const expectedThis = surroundingAgent.feature('runtime-types') ? CallReceiverTypeOf(args) : undefined;
  if (expectedThis && expectedThis !== SelfThisTypeRecord && !SameType(expectedThis, SelfThisTypeRecord)) {
    const closed = substituteTypeParameters(expectedThis, currentTypeParameterFrame() ?? new Map())!;
    if (!Q(yield* IsOfType(thisValue, closed))) return Throw.TypeError('the receiver does not satisfy the declared this type');
  }
  // 6. If tailPosition is true, perform PrepareForTailCall().
  if (tailPosition) {
    PrepareForTailCall();
  }
  // 7. Let result be Call(func, thisValue, argList).
  // proposal-runtime-types #sec-contextual-types: the call's own contextual
  // type - read from its position, which this expression node names - is
  // handed to the callee, whose body binds its type parameters from it before
  // the arguments (#sec-constructing-a-generic-class, the same ladder for a
  // call). Set here, after the arguments have run, and cleared after the call.
  let result;
  if (surroundingAgent.feature('runtime-types')) {
    SetPendingCalleeContext(callContext);
    try {
      result = yield* Call(func, thisValue, argList);
    } finally {
      SetPendingCalleeContext(undefined);
    }
  } else {
    result = yield* Call(func, thisValue, argList);
  }
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
    return Q(yield* DecayReferenceValue(callValue));
  }
  // 10. Return result.
  return result;
}
