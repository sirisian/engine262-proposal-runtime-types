import type { ParseNode } from '../parser/ParseNode.mts';

/**
 * The numeric constants of `Math`, named because none can be written as a
 * literal that denotes it. `Number`'s limits are deliberately absent: they are
 * facts about a REPRESENTATION rather than real numbers, so taking a position's
 * type would let `Number.MAX_SAFE_INTEGER` silently become a `float32` that is
 * not the maximum safe integer of anything.
 */
const WELL_KNOWN_MATH_CONSTANTS = new Set([
  'PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2',
]);

export function isWellKnownNumericConstant(n: ParseNode): boolean {
  const m = n as ParseNode & {
    MemberExpression?: { type?: string, name?: string },
    IdentifierName?: { name?: string },
  };
  return m.MemberExpression?.type === 'IdentifierReference'
    && m.MemberExpression.name === 'Math'
    && typeof m.IdentifierName?.name === 'string'
    && WELL_KNOWN_MATH_CONSTANTS.has(m.IdentifierName.name);
}

