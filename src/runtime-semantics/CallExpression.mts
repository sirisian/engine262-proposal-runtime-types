import { Value, ReferenceRecord, JSStringValue } from '../value.mts';
import { IsInTailPosition } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ClassFieldReflection } from '../intrinsics/Reflect.mts';
import { CreateArrayView } from '../abstract-ops/array-view.mts';
import { CreateSoAView, SoAWithCapacity } from '../intrinsics/SoA.mts';
import { ToIndex } from '../abstract-ops/all.mts';
import { ToString } from '../abstract-ops/all.mts';
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
  // proposal-runtime-types soa.md: `SoA.withCapacity.<T>(n)` — "Empty, capacity
  // >= n". Its element type is a TYPE argument rather than inferred, because
  // there is no value to infer it from, so the call is intercepted where the
  // type arguments are in scope.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && memberExpr.TypeArguments.TypeArgumentList.length === 1) {
    const inner = (memberExpr as unknown as { Expression?: { type?: string, MemberExpression?: { name?: string }, IdentifierName?: { name?: string } } }).Expression;
    if (inner?.type === 'MemberExpression'
        && inner.MemberExpression?.name === 'SoA'
        && inner.IdentifierName?.name === 'withCapacity') {
      const element = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      const argList = Q(yield* ArgumentListEvaluation(args));
      const n = argList.length > 0 ? Number(Q(yield* ToIndex(argList[0]!))) : 0;
      return Q(yield* SoAWithCapacity(element, n));
    }
  }
  // proposal-runtime-types soa.md, "Views": `SoA.<T, N>(buffer, byteOffset)` is
  // a call on the type, as the array view is, and for the same reason: nothing
  // is constructed, the bytes are already there.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && (memberExpr as unknown as { Expression?: { type?: string, name?: string } }).Expression?.type === 'IdentifierReference'
      && (memberExpr as unknown as { Expression: { name?: string } }).Expression.name === 'SoA') {
    const typeArgs = memberExpr.TypeArguments.TypeArgumentList;
    const element = Q(yield* TypeNodeToTypeRecord(typeArgs[0]!));
    let extent = 0;
    if (typeArgs.length > 1) {
      const second = Q(yield* TypeNodeToTypeRecord(typeArgs[1]!));
      if (second.Kind === 'literal' && typeof (second.Value as unknown as { value?: unknown })?.value === 'number') {
        extent = Number((second.Value as unknown as { value: number }).value);
      }
    }
    const argList = Q(yield* ArgumentListEvaluation(args));
    return Q(yield* CreateSoAView(element, extent, argList as unknown as readonly Value[]));
  }
  // proposal-runtime-types (README, "Views"): `[].<T>(buffer, byteOffset,
  // byteElementLength)` and `[N].<T>(...)` are VIEWS over bytes that already
  // exist. The form parses as an ARRAY LITERAL carrying type arguments and then
  // called, which is why it is intercepted here beside the other typed calls
  // rather than by making a Type Object callable.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && (memberExpr as unknown as { Expression?: { type?: string, ElementList?: readonly unknown[] } }).Expression?.type === 'ArrayLiteral'
      && memberExpr.TypeArguments.TypeArgumentList.length === 1) {
    const literal = (memberExpr as unknown as { Expression: { ElementList?: readonly ParseNode[] } }).Expression;
    const elements = literal.ElementList ?? [];
    // `[].<T>` is length-tracking and `[N].<T>` is fixed, so the literal's one
    // element - when it has one - is the extent.
    let extent: number | 'dynamic' = 'dynamic';
    if (elements.length === 1) {
      const only = elements[0] as { type?: string, value?: unknown };
      if (only.type === 'NumericLiteral' && typeof only.value === 'number') {
        extent = only.value;
      } else {
        extent = -1;
      }
    } else if (elements.length > 1) {
      extent = -1;
    }
    if (extent !== -1) {
      const element = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      const argList = Q(yield* ArgumentListEvaluation(args));
      if (argList.length > 0) {
        return Q(yield* CreateArrayView(element, extent, argList as unknown as readonly Value[]));
      }
    }
  }
  // proposal-runtime-types #sec-layout-properties: `Reflect.getReflection.<`
  // `Reflect.ClassField`, T`>(`name`)` reports a field's `offset` and
  // `byteLength`. The context and the type ride on the callee as type
  // arguments, exactly as `JSON.parse.<T>`'s does, so the interception is the
  // same shape - which is why this sits beside it rather than inside
  // getReflection, where the type arguments are not in scope.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && memberExpr.TypeArguments.TypeArgumentList.length === 2) {
    const reflectObj = surroundingAgent.intrinsic('%Reflect%');
    const getReflection = Q(yield* Get(reflectObj, Value('getReflection')));
    if (SameValue(func, getReflection)) {
      const contextRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      if (contextRecord.Kind === 'nominal' && contextRecord.LibraryName === 'Reflect.ClassField') {
        const classRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[1]));
        const argList = Q(yield* ArgumentListEvaluation(args));
        const nameValue = argList.length > 0 ? argList[0]! : Value.undefined;
        const name = Q(yield* ToString(nameValue));
        return Q(ClassFieldReflection(classRecord, name.stringValue(), surroundingAgent.currentRealmRecord));
      }
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
