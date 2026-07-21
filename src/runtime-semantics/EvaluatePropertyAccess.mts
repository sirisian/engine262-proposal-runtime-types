import { Value, ReferenceRecord, ObjectValue, NumberValue, TypedNumberValue } from '../value.mts';
import { Evaluate, type ReferenceEvaluator } from '../evaluator.mts';
import { StringValue } from '../static-semantics/all.mts';
import { Q, type PlainCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  GetValue,
  Assert,
  surroundingAgent,
  LookupClassOperator,
} from '#self';

/** https://tc39.es/ecma262/#sec-evaluate-expression-key-property-access */
export function* EvaluatePropertyAccessWithExpressionKey(baseValue: Value, expression: ParseNode.Expression, strict: boolean): ReferenceEvaluator {
  // 1. Let propertyNameReference be the result of evaluating expression.
  const propertyNameReference = Q(yield* Evaluate(expression));
  // 2. Let propertyNameValue be ? GetValue(propertyNameReference).
  const propertyNameValue = Q(yield* GetValue(propertyNameReference));
  // proposal-runtime-types (spec sec-class-operators): a computed access `m[i]`
  // whose base declares an index operator and whose key is a numeric index
  // dispatches to the operator rather than performing an ordinary property access.
  // A non-numeric key, such as a string method name, is left to ordinary access so
  // an index-defining class keeps its methods reachable.
  let indexOperator: Value | undefined;
  if (surroundingAgent.feature('runtime-types')
      && baseValue instanceof ObjectValue
      && (propertyNameValue instanceof NumberValue || propertyNameValue instanceof TypedNumberValue)) {
    const op = LookupClassOperator(baseValue, '[]');
    if (op) {
      indexOperator = op;
    }
  }
  // 3. Return the Reference Record { [[Base]]: bv, [[ReferencedName]]: propertyKey, [[Strict]]: strict, [[ThisValue]]: empty }.
  return new ReferenceRecord({
    Base: baseValue,
    ReferencedName: propertyNameValue,
    Strict: strict ? Value.true : Value.false,
    ThisValue: undefined,
    IndexOperator: indexOperator,
  });
}

/** https://tc39.es/ecma262/#sec-evaluate-identifier-key-property-access */
export function EvaluatePropertyAccessWithIdentifierKey(baseValue: Value, identifierName: ParseNode.IdentifierName, strict: boolean): PlainCompletion<ReferenceRecord> {
  // 1. Assert: identifierName is an IdentifierName.
  Assert(identifierName.type === 'IdentifierName');
  // 3. Let propertyNameString be StringValue of IdentifierName
  const propertyNameString = StringValue(identifierName);
  // 4. Return the Reference Record { [[Base]]: bv, [[ReferencedName]]: propertyNameString, [[Strict]]: strict, [[ThisValue]]: empty }.
  return new ReferenceRecord({
    Base: baseValue,
    ReferencedName: propertyNameString,
    Strict: strict ? Value.true : Value.false,
    ThisValue: undefined,
  });
}
