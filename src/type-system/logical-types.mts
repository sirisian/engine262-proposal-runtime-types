import type { ParseNode } from '../parser/ParseNode.mts';
import { BigIntValue, Value } from '../value.mts';
import { type TypeRecord, type Known } from './records.mts';
import { CanonicalizeType } from './intern.mts';
import { SameType, IsAssignable } from './relations.mts';
import { NarrowTo, NarrowFrom, nullishType, empty } from './narrowing.mts';
import { literalFitsNumericType } from './literal-fit.mts';
import { R } from '#self';

/**
 * proposal-runtime-types #sec-operator-results, step 1: `&&`, `||` and `??`
 * produce one of their OPERANDS rather than a boolean, so the Static Type is
 * "the union of the short-circuiting part of the left operand's Static Type and
 * the right operand's Static Type, where the short-circuiting part is the falsy
 * part for `&&`, the truthy part for `||`, and, for `??`, the result of
 * NarrowFrom applied to that Static Type and `null | undefined`".
 *
 * Splitting a type by truthiness is the same operation narrowing performs on a
 * test, done here over Type Records alone, with the caller supplying the typing
 * of a sub-expression.
 */

/**
 * Whether a literal type's value is falsy. The set is the language's: *false*,
 * *undefined*, *null*, `0` and `-0` and NaN, `0n`, and the empty String. A
 * TYPED number is the same question asked of the number it carries, since a
 * `uint32` zero is falsy exactly as `0` is.
 */
export const isFalsyLiteralValue = (v: Value): boolean => {
  if (v === Value.false || v === Value.undefined || v === Value.null) {
    return true;
  }
  // A TYPED number carries the Number it was built from, and a `uint32` zero
  // is falsy exactly as `0` is, so both spellings are unwrapped the same way.
  const inner = (v as { value?: Value }).value ?? v;
  if (typeof (inner as { numberValue?: () => number }).numberValue === 'function') {
    const x = Number((inner as { numberValue(): number }).numberValue()); // eslint-disable-line @engine262/mathematical-value -- a truthiness test, not a mathematical value in the spec sense
    return x === 0 || Number.isNaN(x);
  }
  if (inner instanceof BigIntValue) {
    return R(inner) === 0n;
  }
  if (typeof (inner as { stringValue?: () => string }).stringValue === 'function') {
    return (inner as { stringValue(): string }).stringValue() === '';
  }
  return false;
};

/** The union of two known types, canonicalized so member order never shows. */
export const joinTypes = (a: TypeRecord, b: TypeRecord): TypeRecord => (SameType(a, b)
  ? a
  : CanonicalizeType({ Kind: 'union', Members: [a, b] }));

/**
 * proposal-runtime-types #sec-operator-results: the part of _t_ whose values
 * are FALSY, which is what `a && b` yields when the left decides the result. A type whose values are all truthy contributes nothing, so
 * `obj && f()` is just the type of `f()`.
 *
 * The parts are stated per KIND rather than per value: where a falsy value of
 * a kind exists but the system cannot write its literal type - a `uint32`
 * zero is a typed number, not a Number literal - the whole member stands in
 * for it. The specification states no license for this, and one is worth
 * asking for: a wider answer is sound here because it names more values than
 * can occur, never fewer, and the alternative is a literal type the system
 * cannot spell. (An earlier comment attributed such a license to
 * #sec-inferred-result-type, which says nothing of the kind.)
 */
export const falsyPartOf = (t: TypeRecord): TypeRecord | typeof empty => {
  const members = t.Kind === 'union' ? (t as { Members: readonly TypeRecord[] }).Members : [t];
  const kept: TypeRecord[] = [];
  for (const m of members) {
    switch (m.Kind) {
      // Every object, array, tuple, and function value is truthy.
      case 'object': case 'array': case 'tuple': case 'function': case 'nominal':
        break;
      case 'void':
        break;
      case 'literal':
        // A literal type names ONE value, so it is falsy or it is not.
        if (isFalsyLiteralValue((m as { Value: Value }).Value)) {
          kept.push(m);
        }
        break;
      case 'primitive': {
        const name = (m as { Name: string }).Name;
        if (name === 'undefined' || name === 'null') {
          kept.push(m);
          break;
        }
        if (name === 'boolean') {
          kept.push({ Kind: 'literal', Value: Value.false, Base: m } as TypeRecord);
          break;
        }
        if (name === 'symbol' || name === 'type') {
          break;
        }
        // A numeric, string, or bigint member: `0`, `''`, `0n`, and NaN are
        // reachable, and the member stands in for them.
        kept.push(m);
        break;
      }
      default:
        kept.push(m);
        break;
    }
  }
  if (kept.length === 0) {
    return empty;
  }
  return kept.length === 1 ? kept[0]! : CanonicalizeType({ Kind: 'union', Members: kept });
};

/** The part of _t_ whose values are TRUTHY, which `a || b` yields. */
export const truthyPartOf = (t: TypeRecord): TypeRecord | typeof empty => {
  const members = t.Kind === 'union' ? (t as { Members: readonly TypeRecord[] }).Members : [t];
  const kept: TypeRecord[] = [];
  for (const m of members) {
    switch (m.Kind) {
      case 'void':
        break;
      case 'literal':
        if (!isFalsyLiteralValue((m as { Value: Value }).Value)) {
          kept.push(m);
        }
        break;
      case 'primitive': {
        const name = (m as { Name: string }).Name;
        // `undefined` and `null` have exactly one value each, and it is falsy,
        // so neither survives a truthiness test - this is what makes
        // `x || d` on an optional drop the absent arm.
        if (name === 'undefined' || name === 'null') {
          break;
        }
        if (name === 'boolean') {
          kept.push({ Kind: 'literal', Value: Value.true, Base: m } as TypeRecord);
          break;
        }
        kept.push(m);
        break;
      }
      default:
        kept.push(m);
        break;
    }
  }
  if (kept.length === 0) {
    return empty;
  }
  return kept.length === 1 ? kept[0]! : CanonicalizeType({ Kind: 'union', Members: kept });
};

/**
 * The Static Type of `a && b`, `a || b`, and `a ?? b`: the part of the left
 * that SHORT-CIRCUITS, joined with the right. _typeOf_ is how an operand is
 * typed, which is what lets the contextual form pass a position's type down
 * to both operands while the plain form types them in isolation.
 */
export const logicalResultType = (node: ParseNode, typeOf: (n: ParseNode) => Known, contextual: Known = null): Known => {
  let leftNode: ParseNode;
  let rightNode: ParseNode;
  if (node.type === 'CoalesceExpression') {
    const co = node as ParseNode.CoalesceExpression;
    leftNode = co.CoalesceExpressionHead as ParseNode;
    rightNode = co.BitwiseORExpression as ParseNode;
  } else {
    const lg = node as unknown as {
      LogicalANDExpression?: ParseNode, LogicalORExpression?: ParseNode, BitwiseORExpression?: ParseNode,
    };
    const isAnd = node.type === 'LogicalANDExpression';
    leftNode = (isAnd ? lg.LogicalANDExpression : lg.LogicalORExpression) as ParseNode;
    rightNode = (isAnd
      ? lg.BitwiseORExpression
      : (node as unknown as { LogicalANDExpression: ParseNode }).LogicalANDExpression) as ParseNode;
  }
  const left = typeOf(leftNode);
  const right = typeOf(rightNode);
  if (!left || !right) {
    return null;
  }
  // `a && b` yields the left where it is FALSY, `a || b` where it is TRUTHY,
  // and `a ?? b` where it is NULLISH - the last being a membership question
  // the narrowing operations already answer, the same split the `??`
  // dead-test diagnostic reads. A part that cannot occur contributes nothing,
  // which is what makes `s || 'anon'` a plain `string`, `x ?? 10` on an
  // optional a plain `uint32`, and `obj && f()` the type of `f()`.
  const kept = node.type === 'CoalesceExpression'
    ? NarrowFrom(left, nullishType())
    : (node.type === 'LogicalANDExpression' ? falsyPartOf(left) : truthyPartOf(left));
  // Where the left ALWAYS short-circuits, the right is never evaluated and so
  // contributes nothing: `undefined && f()` is `undefined`, not
  // `undefined | uint32`. This is the dual of the case just below, where the
  // left never short-circuits and contributes nothing itself; between them
  // the two keep the type to the values the expression can actually produce.
  const passedOver = node.type === 'CoalesceExpression'
    ? NarrowTo(left, nullishType())
    : (node.type === 'LogicalANDExpression' ? truthyPartOf(left) : falsyPartOf(left));
  if (passedOver === empty && kept !== empty) {
    return kept as TypeRecord;
  }
  // #sec-literal-propagation: a literal in a contextual position IS
  // of that position's type where it fits. Elsewhere that is settled by the
  // assignability check, which reads the literal and the target together; a
  // literal INSIDE a union never meets the target that way, and `const c:
  // uint32 = x || 10` would read as `a literal type of number | uint.<32>`
  // and be refused at its own annotation. Adopting after the short-circuit
  // split keeps the precision that makes `0 || 10` just the right operand.
  const adopt = (t: TypeRecord): TypeRecord => (contextual && t.Kind === 'literal'
    && (IsAssignable(t, contextual) || literalFitsNumericType(t, contextual))
    ? contextual
    : t);
  const adoptedRight = adopt(right);
  return kept === empty ? adoptedRight : joinTypes(adopt(kept as TypeRecord), adoptedRight);
};
