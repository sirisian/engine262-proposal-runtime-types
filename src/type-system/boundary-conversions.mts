import type { Known } from './records.mts';

/** Canonical text is an implicit boundary conversion, not a subtype relation. */
export function CanonicalStringConversion(source: Known, target: Known): boolean {
  const value = source?.Kind === 'literal' ? source.Base : source;
  return target?.Kind === 'primitive' && target.Name === 'string' && target.Arguments.length === 0
    && value?.Kind === 'primitive' && value.Arguments.length === 0
    && ['number', 'bigint', 'boolean'].includes(value.Name);
}
