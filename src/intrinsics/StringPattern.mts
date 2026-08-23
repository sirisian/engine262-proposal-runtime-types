import { Value, JSStringValue, ObjectValue, type Arguments } from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import {  type TypeRecord, anyType } from '../type-system/records.mts';
import {
  Call, ClaimMetaKey, CreateBuiltinFunction, Get, Realm, RegExpCreate, RegisterMetaHook, RegisterTypeDefault, surroundingAgent,
} from '#self';

/**
 * proposal-runtime-types (spec, the metadata protocol and sec-parameterized-types):
 * the `StringPattern` meta type.
 *
 * The clause names three meta types that this specification declares rather than
 * a program: a dependent record's `where`, the brand, and the string pattern.
 * "Nothing about them is special-cased" in the protocol, which is the point of
 * declaring them here: they are ordinary meta types, claiming a key and supplying
 * hooks exactly as a program's would, and the machinery that serves a user's meta
 * type serves these unchanged.
 *
 * `StringPattern` claims `pattern`. Its validation judgment "holds of a String
 * exactly when the ENTIRE String matches the pattern, the whole-string discipline
 * this specification already uses", so the test is anchored rather than a search.
 *
 * Its subtype judgment is not declared here. The clause gives it as holding "only
 * of patterns whose source and flags are identical, which structural equivalence
 * already makes one type", so it is the floor of reflexivity and the interning
 * comparison delivers it; and `subtype` is not consulted anywhere yet, which is
 * its own open item.
 */

/** The constraint shape: `{ pattern: ... }`, whose key is what the meta type claims. */
function stringPatternShape(): TypeRecord {
  return {
    Kind: 'object',
    Properties: [{
      // `any` is its OWN Kind, not a primitive named "any" - `anyType` is the
      // record every program's `any` interns to. Building
      // `makePrimitive('any')` here produced `{ Kind: 'primitive', Name: 'any' }`,
      // which is structurally DIFFERENT, so the meta type this bootstrap
      // registered was never the one `{ pattern: any }` interns to and every
      // lookup against it missed.
      key: 'pattern', type: anyType, optional: false, readonly: false,
    }],
    IndexSignatures: [],
  } as TypeRecord;
}

/** https://sirisian.github.io/ecmascript-types/#sec-parameterized-types */
function* StringPattern_validate([v = Value.undefined, metadata = Value.undefined]: Arguments): ValueEvaluator {
  // A pattern constrains Strings. Anything else is not of the base it refines,
  // and answering false here rather than throwing keeps the judgment total.
  if (!(v instanceof JSStringValue) || !(metadata instanceof ObjectValue)) {
    return Value.false;
  }
  const pattern = Q(yield* Get(metadata, Value('pattern')));
  if (!(pattern instanceof ObjectValue)) {
    return Value.false;
  }
  const source = Q(yield* Get(pattern, Value('source')));
  const flags = Q(yield* Get(pattern, Value('flags')));
  if (!(source instanceof JSStringValue) || !(flags instanceof JSStringValue)) {
    return Value.false;
  }
  // The whole-string discipline: anchor the carried source rather than search
  // with it, so that `/a.c/` admits 'abc' and not 'xabcx'. The group keeps an
  // alternation from binding only its first arm.
  const anchored = Q(yield* RegExpCreate(
    Value(`^(?:${source.stringValue()})$`),
    flags,
  ));
  const test = Q(yield* Get(anchored as ObjectValue, Value('test')));
  const result = Q(yield* Call(test, anchored, [v]));
  return result === Value.true ? Value.true : Value.false;
}

/**
 * Declare the meta type. It runs after %Type.prototype% exists, for the same
 * reason the `never` Type Object does: a Type Object needs that prototype.
 */
export function bootstrapStringPattern(realmRec: Realm) {
  if (!surroundingAgent.feature('runtime-types')) {
    return;
  }
  const metaType = GetTypeObject(stringPatternShape(), realmRec) as unknown as object;
  // A meta type claims the property keys of its constraint shape. Claiming is
  // global and flat, so a program that declares its own meta type over `pattern`
  // collides with this one and is told so at its declaration, which is the
  // intended reading: the key means one thing everywhere.
  ClaimMetaKey('pattern', metaType);
  RegisterTypeDefault(metaType, Value.undefined);
  RegisterMetaHook(
    metaType,
    'validate',
    X(CreateBuiltinFunction(StringPattern_validate, 2, Value('validate'), [], realmRec)),
  );
}
