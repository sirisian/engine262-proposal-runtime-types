import { Value } from '../value.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import { type TypeRecord, anyType } from '../type-system/records.mts';
import {
  ClaimMetaKey, Realm, RegisterTypeDefault, surroundingAgent,
} from '#self';

/**
 * The `brand` meta type.
 *
 * proposal-runtime-types `sec-parameterized-types` reasons about a brand
 * repeatedly - "a brand, whose meta type defines no validation, therefore
 * admits no bare value of its base except through the construction boundary,
 * which is the point of a brand" - and never DECLARES one. So `brand` was
 * claimed by nothing and `uint32.<{ brand: 'UserId' }>` was refused at its
 * declaration: "brand is not claimed by any meta type". This answers it.
 *
 * It is modelled on `StringPattern`, which claims `pattern`, with one
 * deliberate difference: **no `validate` hook is registered**. That absence is
 * the feature rather than an omission. A pattern says which Strings it admits;
 * a brand says that nothing is admitted except what its own construction
 * produced, so there is no judgment to write - the judgment is "no".
 *
 * The constraint shape is `{ brand: any }`, so a tag may be a String or a
 * Symbol. `any` here is `anyType`, the record every program's `any` interns to,
 * NOT `makePrimitive('any')`: the latter is structurally different, and
 * StringPattern's comment records that building it that way registered a meta
 * type nothing ever looked up.
 *
 * Interning does the rest. Two writings of `brand(uint32, 'UserId')` are one
 * type in any module without a registry, which is what typeprogramming.md
 * requires of a brand, and two different tags are two types because
 * `SameMetadata` compares the tag - by `SameValue` for a Symbol, which is what
 * makes a symbol-tagged brand unforgeable.
 */

/** The constraint shape: `{ brand: ... }`, whose key is what the meta type claims. */
function brandShape(): TypeRecord {
  return {
    Kind: 'object',
    Properties: [{
      key: 'brand', type: anyType, optional: false, readonly: false,
    }],
    IndexSignatures: [],
  } as TypeRecord;
}

/**
 * Declare the meta type. It runs after %Type.prototype% exists, for the same
 * reason `StringPattern` does: a Type Object needs that prototype.
 */
export function bootstrapBrand(realmRec: Realm) {
  if (!surroundingAgent.feature('runtime-types')) {
    return;
  }
  const metaType = GetTypeObject(brandShape(), realmRec) as unknown as object;
  ClaimMetaKey('brand', metaType);
  RegisterTypeDefault(metaType, Value.undefined);
  // No `validate` hook, deliberately. See the note above: a brand's meta type
  // defining no validation is what makes it a brand.
}
