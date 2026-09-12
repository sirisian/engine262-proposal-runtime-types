import { type TypeRecord, builtinTypeRecord } from './records.mts';

/**
 * #index-type: the type of every count a container reports or accepts - an
 * array's `length` and `capacity`, an element index, a view's length, a keyed
 * collection's `size`. The specification names it once, as `uint64`, so it is
 * referenced here rather than spelled at each site; `INDEX_TYPE` in value.mts is
 * the RUNTIME's record of the same type, and `collections/size-and-counts` pins
 * the two to each other.
 */
export const indexTypeRecord = (): TypeRecord => builtinTypeRecord('uint', [64])!;
