import { Value, JSStringValue, ObjectValue, type Arguments } from '../value.mts';
import { InspectPattern } from '../type-system/pattern-fragment.mts';
import { DecidesInclusion } from '../type-system/pattern-inclusion.mts';
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
/**
 * `subtype(a, b)` - #sec-metadata: the judgment "holds only of patterns whose
 * `source` and `flags` are identical, which structural equivalence already makes
 * one type, so the floor is reflexivity and the conservatism is intentional."
 *
 * Declared rather than left to fall out of interning. It agreed with interning
 * before and still does, so this changes no answer - what it changes is that the
 * judgment is now CONSULTED, which the clause's own sharpening needs somewhere to
 * live. R18 replaces the body: "pattern pairs free of backreferences and
 * lookaround, within a fixed automaton size, get the exact language-inclusion
 * answer, and pairs beyond the bound get the syntactic one."
 *
 * A missing pattern on either side is not this judgment's business. The hook is
 * never asked about a default (#sec-metadata-subtype-judgment skips
 * `subtype(default, default)`), and a crossing that carries a pattern one way
 * only is decided by the branding rule above it.
 */
/**
 * The size bound for the exact tier, summed over both patterns.
 *
 * #sec-metadata leaves it open: "the size constant is among the design's open
 * budget numbers". Chosen by measuring what real patterns cost, in node counts
 * under this construction:
 *
 *   ^a$ 9, ^a|b$ 13, ^(ab)+$ 17, ^ab(ab)*$ 21, suffixed("Id") 15,
 *   prefixed("get") 17, suffixed(".js") 19, an identifier 24, a date 29,
 *   an eight-way alternation 43, an email 54.
 *
 * 100 admits every pair of those but the widest - two emails is 108 - and a
 * pattern that large is one where an exact answer matters least.
 *
 * It is conservative on purpose. The syntactic size bounds the NFA and NOT the
 * determinized product, so it is not a proof that the walk is cheap; it is a
 * bound that is the same on every host, which is the property the clause
 * requires. A tighter guarantee would need a bound on the product, and a guard
 * that gave up mid-walk would decide the tier by fuel, which is what the clause
 * forbids.
 */
const EXACT_TIER_SIZE = 100;

function* StringPattern_subtype([a = Value.undefined, b = Value.undefined]: Arguments): ValueEvaluator {
  if (!(a instanceof ObjectValue) || !(b instanceof ObjectValue)) {
    return Value.false;
  }
  const left = Q(yield* Get(a, Value('pattern')));
  const right = Q(yield* Get(b, Value('pattern')));
  if (!(left instanceof ObjectValue) || !(right instanceof ObjectValue)) {
    return Value.false;
  }
  const leftSource = Q(yield* Get(left, Value('source')));
  const rightSource = Q(yield* Get(right, Value('source')));
  const leftFlags = Q(yield* Get(left, Value('flags')));
  const rightFlags = Q(yield* Get(right, Value('flags')));
  if (!(leftSource instanceof JSStringValue) || !(rightSource instanceof JSStringValue)
      || !(leftFlags instanceof JSStringValue) || !(rightFlags instanceof JSStringValue)) {
    return Value.false;
  }
  const aSource = leftSource.stringValue();
  const bSource = rightSource.stringValue();
  const aFlags = leftFlags.stringValue();
  const bFlags = rightFlags.stringValue();
  if (aSource === bSource && aFlags === bFlags) {
    // The floor, and the fast path: structural equivalence already makes these
    // one type.
    return Value.true;
  }
  // #sec-metadata's sanctioned sharpening: "pattern pairs free of backreferences
  // and lookaround, within a fixed automaton size, get the exact
  // language-inclusion answer, and pairs beyond the bound get the syntactic one.
  // The tier is decided by syntactic size and never by remaining fuel."
  //
  // FLAGS must match for the exact tier. They change what a pattern matches, so
  // two patterns under different flags are different languages and this
  // construction does not model the difference. Sound, weak, sharpenable.
  if (aFlags !== bFlags) {
    return Value.false;
  }
  const leftReport = InspectPattern(aSource, aFlags);
  const rightReport = InspectPattern(bSource, bFlags);
  if (leftReport.outside !== undefined || rightReport.outside !== undefined
      || leftReport.size + rightReport.size > EXACT_TIER_SIZE) {
    return Value.false;
  }
  const exact = DecidesInclusion({ source: aSource, flags: aFlags, ast: leftReport.ast },
    { source: bSource, flags: bFlags, ast: rightReport.ast });
  // `undefined` is a form the construction does not model, which takes the
  // syntactic answer like anything else outside the exact tier.
  return exact === true ? Value.true : Value.false;
}

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
  RegisterMetaHook(
    metaType,
    'subtype',
    X(CreateBuiltinFunction(StringPattern_subtype, 2, Value('subtype'), [], realmRec)),
  );
}
