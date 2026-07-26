import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { BindPlacement, ValidatePlacement } from '../abstract-ops/placement.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { isArray } from '../utils/language.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { ObjectValue, type Value } from '../value.mts';
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
function* EvaluateNew(constructExpr: ParseNode.LeftHandSideExpression, args: undefined | ParseNode.Arguments, placementArgs?: readonly ParseNode.AssignmentExpressionOrHigher[] | null) {
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
  // The placement is VALIDATED before the constructor runs: the extent depends
  // only on the arguments and the type's layout, and checking it afterwards
  // would let a constructor with side effects run for a placement that can
  // never happen.
  let placementBacking;
  if (surroundingAgent.feature('runtime-types') && placementArgs !== undefined && placementArgs !== null) {
    const placementValues: Value[] = [];
    for (const argNode of placementArgs) {
      placementValues.push(Q(yield* GetValue(Q(yield* Evaluate(argNode)))));
    }
    placementBacking = Q(yield* ValidatePlacement(constructor as ObjectValue, placementValues));
  }
  // 8. Return ? Construct(constructor, argList).
  const constructed = Q(yield* Construct(constructor, argList));
  // proposal-runtime-types, the PLACEMENT forms: `new(buffer, byteOffset,
  // byteLength) Type(args)`. The parser has built these arguments since the
  // form was added and NOTHING consumed them, so a placement construction
  // allocated fresh storage and silently discarded the buffer it was handed -
  // which reads as support.
  //
  // The instance is constructed first and then BOUND to the buffer, so the
  // constructor body runs exactly as it does for a fresh allocation and its
  // field writes land in the buffer through the same store path. The
  // alternative - binding before construction - would need the constructor to
  // know it is being placed.
  if (placementBacking !== undefined && constructed instanceof ObjectValue) {
    Q(yield* BindPlacement(constructed, placementBacking));
  }
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
export function* Evaluate_NewExpression(node: ParseNode.NewExpression): ValueEvaluator {
  const { MemberExpression, Arguments } = node;
  const placementArgs = (node as { PlacementArguments?: readonly ParseNode.AssignmentExpressionOrHigher[] | null }).PlacementArguments;
  if (!Arguments) {
    // 1. Return ? EvaluateNew(NewExpression, empty).
    return Q(yield* EvaluateNew(MemberExpression, undefined, placementArgs));
  } else {
    // 1. Return ? EvaluateNew(MemberExpression, Arguments).
    return Q(yield* EvaluateNew(MemberExpression, Arguments, placementArgs));
  }
}
