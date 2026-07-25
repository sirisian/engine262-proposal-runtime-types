import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { isArray } from '../utils/language.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { ObjectValue } from '../value.mts';
import { ArgumentListEvaluation } from './all.mts';
import { surroundingAgent } from '#self';
import {
  Assert,
  Construct,
  GetValue,
  IsConstructor,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-evaluatenew */
function* EvaluateNew(constructExpr: ParseNode.LeftHandSideExpression, args: undefined | ParseNode.Arguments) {
  // 1. Assert: constructExpr is either a NewExpression or a MemberExpression.
  // 2. Assert: arguments is either empty or an Arguments.
  Assert(args === undefined || isArray(args));
  // 3. Let ref be the result of evaluating constructExpr.
  const ref = Q(yield* Evaluate(constructExpr));
  // 4. Let constructor be ? GetValue(ref).
  const constructor = Q(yield* GetValue(ref));
  let argList;
  // 5. If arguments is empty, let argList be a new empty List.
  if (args === undefined) {
    argList = [];
  } else { // 6. Else,
    // a. Let argList be ? ArgumentListEvaluation of arguments.
    argList = Q(yield* ArgumentListEvaluation(args));
  }
  // 7. If IsConstructor(constructor) is false, throw a TypeError exception.
  if (!IsConstructor(constructor)) {
    return Throw.TypeError('$1 is not a constructor', constructor);
  }
  // 8. Return ? Construct(constructor, argList).
  const constructed = Q(yield* Construct(constructor, argList));
  // proposal-runtime-types: `new Set.<uint8>()` carries its type arguments on
  // the construction, and nothing was carrying them to the object - the
  // specialization form handles a generic ALIAS and returns the plain
  // constructor for a library generic, so the collection came back unstamped
  // and every method went unchecked. An annotation happens to make this
  // unnecessary, since the binding's boundary stamps instead, which is why the
  // common spelling worked and the direct one did not (F73).
  if (surroundingAgent.feature('runtime-types')
      && constructExpr.type === 'TypeArgumentsExpression'
      && constructed instanceof ObjectValue) {
    const spec = constructExpr as unknown as ParseNode.TypeArgumentsExpression;
    const baseName = spec.Expression.type === 'IdentifierReference'
      ? (spec.Expression as unknown as { name: string }).name
      : undefined;
    if (baseName === 'Set' || baseName === 'Map' || baseName === 'WeakSet' || baseName === 'WeakMap') {
      const argRecords: TypeRecord[] = [];
      for (const argNode of spec.TypeArguments.TypeArgumentList) {
        argRecords.push(Q(yield* TypeNodeToTypeRecord(argNode)));
      }
      (constructed as { TypedCollection?: readonly TypeRecord[] }).TypedCollection = argRecords;
    }
  }
  return constructed;
}

/** https://tc39.es/ecma262/#sec-new-operator-runtime-semantics-evaluation */
//   NewExpression :
//     `new` NewExpression
//     `new` MemberExpression Arguments
export function* Evaluate_NewExpression({ MemberExpression, Arguments }: ParseNode.NewExpression): ValueEvaluator {
  if (!Arguments) {
    // 1. Return ? EvaluateNew(NewExpression, empty).
    return Q(yield* EvaluateNew(MemberExpression, undefined));
  } else {
    // 1. Return ? EvaluateNew(MemberExpression, Arguments).
    return Q(yield* EvaluateNew(MemberExpression, Arguments));
  }
}
