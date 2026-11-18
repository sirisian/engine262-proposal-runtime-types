import { isWellKnownNumericConstant } from '../type-system/numeric-constants.mts';
import { contextualTypeFor, typeParameterBindingScopes, currentTypeParameterFrame, isValueParameterBinding } from '../type-system/runtime.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import { IsConstLiteralUse, IsLetConstantUse } from '../type-system/check.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ApplyStringOrNumericBinaryOperator, type BinaryOperator } from './all.mts';
import { GetValue, surroundingAgent, DeclarativeEnvironmentRecord, Value } from '#self';

/**
 * #sec-arithmetic-never-promotes: "Where one operand is a literal it takes the
 * type of the other, so a literal never forces a conversion." Literalness is a
 * property of the SOURCE TEXT, not of the value - by the time a NumericLiteral
 * has been evaluated it is an ordinary Number, indistinguishable from one that
 * arrived through a variable of the `any` type, and those two must behave
 * differently: the literal adopts the type, the `any` value is a mix and
 * throws. So the operand nodes answer the question and the answer travels with
 * the values. A parenthesized literal and a negated one are literals.
 */
/** Whether _name_ resolves to a value generic parameter in the running context. */
function isValueGenericReference(name: string): boolean {
  type Scope = { TypeParameterList?: readonly { BindingIdentifier?: { name?: string } | null, IsValueParameter?: boolean }[], OuterEnv?: unknown };
  for (let env = surroundingAgent.runningExecutionContext?.LexicalEnvironment as unknown as Scope | null; env; env = env.OuterEnv as Scope | null) {
    const parameter = env.TypeParameterList?.find((p) => p.BindingIdentifier?.name === name);
    if (parameter) return !!parameter.IsValueParameter;
    if (env instanceof DeclarativeEnvironmentRecord && (env as unknown as { bindings: { has(key: Value): boolean } }).bindings.has(Value(name))) return typeParameterBindingScopes.has(env);
  }
  // A name no environment binds may still be a type parameter, resolved
  // through the type-parameter frame of the evaluation in progress.
  const bound = currentTypeParameterFrame()?.get(name);
  return !!bound && isValueParameterBinding(bound);
}

/**
 * Whether _node_ is arithmetic over numeric constants and nothing else: a
 * numeric literal, a use of a `const` bound to a numeric constant, a constant
 * of the Math object, a sign or parentheses around one of these, or `+`, `-`,
 * `*`, `/`, `%` or `**` over two of them. These are the shapes the initializer
 * of a numeric constant may have (#sec-static-type-of-an-expression), so that
 * the expression written at a position and a `const` bound to it are one thing.
 *
 * The right operand is asked first: arithmetic nests to the left, so an
 * operand that is not a constant is usually found there at once.
 */
function isNumericConstantOperand(node: ParseNode): boolean {
  let n = node;
  for (;;) {
    switch (n.type) {
      case 'ParenthesizedExpression':
        n = n.Expression;
        continue;
      case 'UnaryExpression':
        if (n.operator !== '-' && n.operator !== '+') return false;
        n = n.UnaryExpression;
        continue;
      case 'NumericLiteral':
        return typeof n.value === 'number';
      case 'IdentifierReference':
        return IsConstLiteralUse(n);
      case 'MemberExpression':
        return isWellKnownNumericConstant(n);
      case 'AdditiveExpression':
        return isNumericConstantOperand(n.MultiplicativeExpression) && isNumericConstantOperand(n.AdditiveExpression);
      case 'MultiplicativeExpression':
        return isNumericConstantOperand(n.ExponentiationExpression) && isNumericConstantOperand(n.MultiplicativeExpression);
      case 'ExponentiationExpression':
        return isNumericConstantOperand(n.ExponentiationExpression) && isNumericConstantOperand(n.UpdateExpression);
      default:
        return false;
    }
  }
}

export function isNumericLiteralOperand(node: ParseNode): boolean {
  let n = node;
  for (;;) {
    if (n.type === 'ParenthesizedExpression') {
      n = (n as { Expression: ParseNode }).Expression;
      continue;
    }
    if (n.type === 'CommaOperator') {
      // Only the result producer adopts. Evaluation has already performed all
      // earlier operands, including their effects and abrupt completions.
      n = n.ExpressionList.at(-1)!;
      continue;
    }
    if (n.type === 'UnaryExpression' && ((n as { operator?: string }).operator === '-' || (n as { operator?: string }).operator === '+')) {
      n = (n as { UnaryExpression: ParseNode }).UnaryExpression;
      continue;
    }
    // A well-known numeric constant answers yes. `Math.PI * r` must mean what
    // `3.14159... * r` means, and the constant cannot be WRITTEN as a literal
    // that denotes it, which is the only reason a list is needed at all.
    //
    // Narrowing its `float64` value to the position's type is CORRECTLY
    // ROUNDED, not double rounding: an intermediate of 2p + 2 bits rounds
    // equivalently to rounding once, and `float64`'s 53 covers `float32`'s 50
    // and `float16`'s 24. Verified for all eight constants at both widths.
    if (n.type === 'MemberExpression' && isWellKnownNumericConstant(n)) {
      return true;
    }
    // A value generic parameter answers yes: the spec binds it to the literal
    // type of its value, so `this > N` means what `this > 1` means.
    if (n.type === 'IdentifierReference' && isValueGenericReference((n as { name: string }).name)) {
      return true;
    }
    // A `const` bound to a compile-time numeric constant answers yes: its use
    // behaves as if the initializer were written here, which is what makes
    // `const K = 3.14; K * r` mean what `3.14 * r` means.
    if (n.type === 'IdentifierReference' && IsConstLiteralUse(n as object)) {
      return true;
    }
    // A constant expression over literals is judged as its value
    // (#sec-contextual-types, "An arithmetic expression every operand of which
    // is compile-time evaluable"), and a `const` bound to one "behaves as if
    // inlined" - so the expression written here answers as that `const` does.
    // `z * K` with `const K = 4 ** 2` took `z`'s type and `z * 4 ** 2` did not:
    // it was a Number beside a `uint32`, a TypeError where it computed, and a
    // silent *false* where it compared, `z === 2 + 1` for a `z` that is 3.
    if (n.type === 'AdditiveExpression' || n.type === 'MultiplicativeExpression' || n.type === 'ExponentiationExpression') {
      return isNumericConstantOperand(n);
    }
    return n.type === 'NumericLiteral';
  }
}

/** https://tc39.es/ecma262/#sec-evaluatestringornumericbinaryexpression */
export function* EvaluateStringOrNumericBinaryExpression(leftOperand: ParseNode.Expression, opText: BinaryOperator, rightOperand: ParseNode.Expression): ValueEvaluator {
  // 1. Let lref be the result of evaluating leftOperand.
  const lref = Q(yield* Evaluate(leftOperand));
  // 2. Let lval be ? GetValue(lref).
  const lval = Q(yield* GetValue(lref));
  // 3. Let rref be the result of evaluating rightOperand.
  const rref = Q(yield* Evaluate(rightOperand));
  // 4. Let rval be ? GetValue(rref).
  const rval = Q(yield* GetValue(rref));
  // 5. Return ? ApplyStringOrNumericBinaryOperator(lval, opText, rval).
  return Q(yield* ApplyStringOrNumericBinaryOperator(lval, opText, rval, {
    left: isNumericLiteralOperand(leftOperand as ParseNode),
    right: isNumericLiteralOperand(rightOperand as ParseNode),
    // For the diagnostic only: a `let` bound to a numeric constant does not
    // adopt, deliberately, but it is the one failure with a one-word fix.
    leftLetConst: IsLetConstantUse(leftOperand as object),
    rightLetConst: IsLetConstantUse(rightOperand as object),
  }, contextualTypeFor(leftOperand.parent)));
}
