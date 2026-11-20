import { ObjectValue, Value } from '../value.mts';
import { currentContextualType, pushContextualType, popContextualType } from '../type-system/runtime.mts';
import { Evaluate, type Evaluator, type ValueEvaluator } from '../evaluator.mts';
import {
  Completion,
  EnsureCompletion,
  Await,
  Q, X,
  ReturnCompletion,
  ThrowCompletion,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { IsValueType, IsValueTypeClass } from '../type-system/layout.mts';
import { CopyValueClassInstance } from '../abstract-ops/testing-comparison.mts';
import { returnTypeRecordOf } from '../abstract-ops/runtime-types.mts';
import { copiesOnBinding } from './LexicalDeclaration.mts';
import { GetGeneratorKind, surroundingAgent, ForwardResultDependency, GetResultValue } from '#self';

/**
 * #sec-value-type-copying: "returning" a value of a value type copies it, and
 * "the copy is NOT taken at a type boundary". Only the boundary copied: a
 * return whose declared or published type is a value type class or a fixed
 * aggregate of value types copied there (EnforceReturnType), and every other
 * return handed back the value its operand named. So a function, method or
 * getter declared to return `any` gave the caller its operand itself:
 * `get origin(): any { return this.o; }` let `s.origin.x = 1` write `this.o`,
 * where the same getter with no annotation, or declared `: Point`, gave a copy.
 * Overriding a getter or a method declared `: Point`, it also made the
 * checker's "the store is lost" false of that subclass (#sec-store-to-a-copy).
 *
 * The copy is decided by the operand, as a binding's is (`copiesOnBinding`): a
 * construction builds in the caller's slot, and `return ref` answers a
 * location, which is not a value. A constructor's `return` gives [[Construct]]
 * its result, which is the construction itself. Where a boundary copies as
 * well, the second copy is of a value nothing else names.
 */
export function* CopyReturnedValue(expression: ParseNode, value: Value): ValueEvaluator {
  if (!surroundingAgent.feature('runtime-types') || !(value instanceof ObjectValue)) {
    return value;
  }
  let operand = expression;
  while (operand.type === 'ParenthesizedExpression') {
    operand = (operand as ParseNode.ParenthesizedExpression).Expression;
  }
  if (!copiesOnBinding(operand) || operand.type === 'RefExpression') {
    return value;
  }
  const running = surroundingAgent.runningExecutionContext.Function;
  if ((running as { IsClassConstructor?: Value }).IsClassConstructor === Value.true) {
    return value;
  }
  // A window is a run of the storage it is over (#sec-span-type), as at a
  // parameter: a copy first would give the caller a window onto the copy. A
  // value type class or a fixed aggregate of value types is copied by the
  // boundary that follows, and is not copied twice.
  const declared = EnsureCompletion(yield* returnTypeRecordOf(running));
  const type = declared.Type === 'normal' ? declared.Value as TypeRecord | null : null;
  if (type && (type.Kind === 'reference' || holdsWindow(type) || IsValueTypeClass(type)
      || ((type.Kind === 'array' || type.Kind === 'tuple') && IsValueType(type)))) {
    return value;
  }
  return Q(yield* CopyValueClassInstance(value));
}

function holdsWindow(type: TypeRecord): boolean {
  if (type.Kind === 'union') {
    return type.Members.some(holdsWindow);
  }
  return type.Kind === 'nominal' && (type.LibraryName === 'Span' || type.LibraryName === 'ReadonlySpan');
}

/** https://tc39.es/ecma262/#sec-return-statement-runtime-semantics-evaluation */
//  ReturnStatement :
//    `return` `;`
//    `return` Expression `;`
export function* Evaluate_ReturnStatement({ Expression }: ParseNode.ReturnStatement): Evaluator<ReturnCompletion | ThrowCompletion> {
  if (!Expression) {
    // 1. Return Completion { [[Type]]: return, [[Value]]: undefined, [[Target]]: empty }.
    return new Completion({ Type: 'return', Value: Value.undefined, Target: undefined });
  }
  // 1. Let exprRef be the result of evaluating Expression.
  // proposal-runtime-types #sec-check-insertion: "the operand of a `return`
  // in a function with a declared return type" takes that type. The body's
  // declared return is on the stack (EvaluateBody pushed it for the body);
  // it is re-pushed here FOR THE OPERAND, which is the position.
  let expressionResult;
  if (surroundingAgent.feature('runtime-types')) {
    pushContextualType(currentContextualType() ?? null, Expression as object);
    try {
      expressionResult = EnsureCompletion(yield* Evaluate(Expression));
    } finally {
      popContextualType();
    }
  } else {
    expressionResult = EnsureCompletion(yield* Evaluate(Expression));
  }
  if (expressionResult.Type !== 'normal') return expressionResult;
  const valueResult = EnsureCompletion(yield* GetResultValue(expressionResult));
  if (valueResult.Type !== 'normal') return valueResult;
  let exprValue = Q(yield* CopyReturnedValue(Expression, valueResult.Value));
  // 1. If ! GetGeneratorKind() is async, set exprValue to ? Await(exprValue).
  if (X(GetGeneratorKind()) === 'async') {
    exprValue = Q(yield* Await(exprValue));
  }
  // 1. Return Completion { [[Type]]: return, [[Value]]: exprValue, [[Target]]: empty }.
  return ForwardResultDependency(valueResult, new Completion({ Type: 'return', Value: exprValue, Target: undefined }));
}
