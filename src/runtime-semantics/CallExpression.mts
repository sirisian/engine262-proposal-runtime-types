import { Value, ReferenceRecord, JSStringValue } from '../value.mts';
import { IsInTailPosition } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { TypedJSONParse } from '../intrinsics/JSON.mts';
import { TypedRandom } from '../intrinsics/Math.mts';
import { EvaluateCall, ArgumentListEvaluation } from './all.mts';
import {
  surroundingAgent,
  GetValue,
  Get,
  IsPropertyReference,
  PerformEval,
  SameValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-function-calls-runtime-semantics-evaluation */
// CallExpression :
//   CoverCallExpressionAndAsyncArrowHead
//   CallExpression Arguments
export function* Evaluate_CallExpression(CallExpression: ParseNode.CallExpression): ValueEvaluator {
  // 1. Let expr be CoveredCallExpression of CoverCallExpressionAndAsyncArrowHead.
  const expr = CallExpression;
  // 2. Let memberExpr be the MemberExpression of expr.
  const memberExpr = expr.CallExpression;
  // 3. Let arguments be the Arguments of expr.
  const args = expr.Arguments;
  // 4. Let ref be the result of evaluating memberExpr.
  const ref = Q(yield* Evaluate(memberExpr));
  // 5. Let func be ? GetValue(ref).
  const func = Q(yield* GetValue(ref));
  // proposal-runtime-types (serialization.md): `JSON.parse.<T>(text)` is the
  // typed parse. Its type argument rides on the callee, which is a
  // TypeArgumentsExpression, so it is intercepted here where both the callee node
  // and the resolved function are in hand. The type argument becomes a Type
  // Record and the validating, converting parse runs in place of the untyped
  // call. With the feature off this path is never taken and the call is ordinary.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && SameValue(func, surroundingAgent.intrinsic('%JSON.parse%'))) {
    const typeArgs = memberExpr.TypeArguments.TypeArgumentList;
    if (typeArgs.length === 1) {
      const typeRecord = Q(yield* TypeNodeToTypeRecord(typeArgs[0]));
      const argList = Q(yield* ArgumentListEvaluation(args));
      const text = argList.length > 0 ? argList[0]! : Value.undefined;
      return Q(yield* TypedJSONParse(text, typeRecord));
    }
  }
  // proposal-runtime-types (random.md): the no-argument typed form
  // `Math.random.<T>()`, whose type argument likewise rides on the callee. Only
  // the zero-argument form is intercepted here; the array-fill and range
  // overloads and a second (PRNG method) type argument fall through to the
  // ordinary call. TypedRandom returns undefined for a type it does not produce
  // (a plain number, a bigint, a wide integer), so that call is ordinary too.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && args.length === 0
      && memberExpr.TypeArguments.TypeArgumentList.length === 1) {
    const mathRandom = Q(yield* Get(surroundingAgent.intrinsic('%Math%'), Value('random')));
    if (SameValue(func, mathRandom)) {
      const typeRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      const produced = TypedRandom(typeRecord, surroundingAgent.currentRealmRecord);
      if (produced !== undefined) {
        return produced;
      }
    }
  }
  // 6. If Type(ref) is Reference, IsPropertyReference(ref) is false, and GetReferencedName(ref) is "eval", then
  if (ref instanceof ReferenceRecord
      && IsPropertyReference(ref) === Value.false
      && (ref.ReferencedName instanceof JSStringValue
      && ref.ReferencedName.stringValue() === 'eval')) {
    // a. If SameValue(func, %eval%) is true, then
    if (SameValue(func, surroundingAgent.intrinsic('%eval%'))) {
      // i. Let argList be ? ArgumentListEvaluation of arguments.
      const argList = Q(yield* ArgumentListEvaluation(args));
      // ii. If argList has no elements, return undefined.
      if (argList.length === 0) {
        return Value.undefined;
      }
      // iii. Let evalText be the first element of argList.
      const evalText = argList[0]!;
      // iv. If the source code matching this CallExpression is strict mode code, let strictCaller be true. Otherwise let strictCaller be false.
      const strictCaller = CallExpression.strict;
      // vi. Return ? PerformEval(evalText, strictCaller, true).
      return Q(yield* PerformEval(evalText, strictCaller, true));
    }
  }
  // 7. Let thisCall be this CallExpression.
  const thisCall = CallExpression;
  // 8. Let tailCall be IsInTailPosition(thisCall).
  const tailCall = IsInTailPosition(thisCall);
  // 9. Return ? EvaluateCall(func, ref, arguments, tailCall).
  return Q(yield* EvaluateCall(func, ref, args, tailCall, CallExpression));
}
