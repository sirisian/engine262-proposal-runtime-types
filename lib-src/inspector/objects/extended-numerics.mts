import type { ComplexObject, DecimalObject } from '#self';
import { complexToString, DecimalToString } from '#self';
import { ObjectInspector } from './objects.mts';

/**
 * proposal-runtime-types: `complex64` and `decimal128` values.
 *
 * Without these they fall through to the ordinary object inspector and describe
 * as a bare `Object`, while the NEIGHBOURING kind - a typed number - describes
 * as `1 (uint8)`. Both halves of the better description already existed:
 *
 *   - the VALUE, from the intrinsic's own text function. `complexToString`'s
 *     comment states the format - "the shape follows the literal syntax so a
 *     value reads back as one writes it: `complex(0, 4)` prints as `4i`, and a
 *     pair with both parts prints as `3+4i`";
 *   - the TYPE name, from the house style `${value} (${typeName})` that
 *     `primitives.mts` uses for a typed number.
 *
 * The intrinsic's function is called DIRECTLY, as `dates.mts` calls
 * `DateProto_toISOString`. A formatter holds a `Value`, so the host's
 * `.toString()` answers `[object Object]` - measured, before this was written.
 */
export const Complex = new ObjectInspector<ComplexObject>(
  'Complex',
  undefined,
  (value) => `${complexToString(value)} (complex64)`,
);

export const Decimal = new ObjectInspector<DecimalObject>(
  'Decimal',
  undefined,
  (value) => `${DecimalToString(value)} (decimal128)`,
);
