import type { ParseNode } from '../parser/ParseNode.mts';
import type { TypeRecord } from './records.mts';
import { CanonicalizeType } from './intern.mts';
import { NumberValue, isTypedNumber } from '../value.mts';

const constantIndices = new WeakMap<object, number>();

/** #sec-compile-time-evaluability: a constant value argument is resolved from its declaration. */
export function SetVectorConstantIndex(argument: object, value: number): void {
  constantIndices.set(argument, value);
}

export function VectorConstantIndexOf(argument: object): number | undefined {
  return constantIndices.get(argument);
}

export type VectorMethod = 'lane' | 'withLane' | 'swizzle' | 'shuffle';

/** #sec-vector-lanes: a bound value parameter may already carry its numeric type. */
export function vectorIndexOf(type: TypeRecord | null): number | null {
  if (!type || type.Kind === 'any' || type.Kind === 'parameter') return null;
  if (type.Kind !== 'literal') return NaN;
  const value = type.Value;
  if (value instanceof NumberValue) return value.numberValue();
  if (isTypedNumber(value)) return Number(value.value);
  return NaN;
}

/** #sec-vector-lanes: parentheses and constant property names denote the same method. */
export function specializedVectorMethod(callee: ParseNode) {
  while (callee.type === 'ParenthesizedExpression') callee = callee.Expression;
  if (callee.type !== 'TypeArgumentsExpression') return null;
  let member: ParseNode = callee.Expression;
  while (member.type === 'ParenthesizedExpression') member = member.Expression;
  if (member.type !== 'MemberExpression' || !member.MemberExpression) return null;
  const name = member.IdentifierName?.name ?? (member.Expression?.type === 'StringLiteral' ? member.Expression.value : undefined);
  if (name !== 'lane' && name !== 'withLane' && name !== 'swizzle' && name !== 'shuffle') return null;
  return { callee, member, receiver: member.MemberExpression, method: name as VectorMethod, arguments: callee.TypeArguments.TypeArgumentList };
}

/** #sec-vector-lanes and #sec-vector-permutation: shared specialization judgments. */
export function vectorSpecialization(vector: TypeRecord | null, method: VectorMethod, indices: readonly (number | null)[]) {
  if (vector?.Kind !== 'primitive' || vector.Name !== 'vector') return null;
  const [lane, count] = vector.Arguments;
  if (!lane || typeof lane === 'number' || typeof count !== 'number') return null;
  const permutation = method === 'swizzle' || method === 'shuffle';
  const bound = method === 'shuffle' ? 2 * count : count;
  let error: string | undefined;
  if (permutation ? indices.length < 1 : indices.length !== 1) {
    error = `${method} requires ${permutation ? 'at least one lane index' : 'one lane index'}`;
  } else if (indices.some((index) => index !== null && (!Number.isInteger(index) || index < 0 || index >= bound))) {
    error = `a lane index is out of range: ${method} requires integer indices from 0 to ${bound - 1}`;
  }
  return {
    error,
    argument: method === 'withLane' ? lane : method === 'shuffle' ? vector : null,
    result: method === 'lane' ? lane : permutation
      ? CanonicalizeType({ ...vector, Arguments: [lane, indices.length] }) : vector,
  };
}
