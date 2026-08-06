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
  // proposal-runtime-types #sec-class-operators: a computed access may supply
  // SEVERAL indices, `grid[x, y]`, which an index accessor of that many
  // parameters receives as its argument list.
  //
  // The base language reads the brackets as one expression, so `m[a, b]` is a
  // comma expression: both operands evaluate, in order, and the last is the
  // key. The operands are taken apart here rather than in the parser so that
  // reading stays exactly what it was wherever no accessor applies - the same
  // operands are evaluated in the same order either way, and only WHICH of
  // their values is used differs. A parenthesized `m[(a, b)]` is one operand,
  // as it reads, since the comma is then inside the parentheses.
  const operands: readonly ParseNode.Expression[] = surroundingAgent.feature('runtime-types')
    && (expression as { type?: string }).type === 'CommaOperator'
    ? ((expression as unknown as ParseNode.CommaOperator).ExpressionList as readonly ParseNode.Expression[])
    : [expression];
  const indexValues: Value[] = [];
  for (const operand of operands) {
    indexValues.push(Q(yield* GetValue(Q(yield* Evaluate(operand)))));
  }
  // The key an ordinary access uses is the last operand's value, which is what
  // the comma expression produced before.
  const propertyNameValue = indexValues[indexValues.length - 1]!;
  // proposal-runtime-types (spec sec-class-operators): a computed access `m[i]`
  // whose base declares an index operator and whose key is a numeric index
  // dispatches to the operator rather than performing an ordinary property access.
  // A non-numeric key, such as a string method name, is left to ordinary access so
  // an index-defining class keeps its methods reachable.
  let indexOperator: Value | undefined;
  let indexSetOperator: Value | undefined;
  let indexArguments: readonly Value[] | undefined;
  // Every index must be numeric for the accessor to apply, which is the rule a
  // single index already followed: a key of another kind stays an ordinary
  // property access, so a class that declares an accessor keeps its methods and
  // its string-keyed properties reachable.
  const allNumeric = indexValues.every((v) => v instanceof NumberValue || v instanceof TypedNumberValue);
  if (surroundingAgent.feature('runtime-types')
      && baseValue instanceof ObjectValue
      && allNumeric) {
    // Resolution is by the number of indices supplied, so `[i]` and `[x, y]`
    // declared on one class are each reached by the access that matches.
    const arity = indexValues.length;
    const op = LookupClassOperator(baseValue, `[]#${arity}`);
    if (op) {
      indexOperator = op;
      indexArguments = indexValues;
    }
    // proposal-runtime-types (operatoroverloading.md): the write half. Carried on
    // the reference beside the read half so that `m[i] = v` reaches the class's own
    // declaration rather than quietly creating an ordinary property the dispatching
    // read would never look at.
    const setOp = LookupClassOperator(baseValue, `[]=#${arity}`);
    if (setOp) {
      indexSetOperator = setOp;
      indexArguments = indexValues;
    }
  }
  // 3. Return the Reference Record { [[Base]]: bv, [[ReferencedName]]: propertyKey, [[Strict]]: strict, [[ThisValue]]: empty }.
  return new ReferenceRecord({
    Base: baseValue,
    ReferencedName: propertyNameValue,
    Strict: strict ? Value.true : Value.false,
    ThisValue: undefined,
    IndexOperator: indexOperator,
    IndexArguments: indexArguments,
    IndexSetOperator: indexSetOperator,
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
