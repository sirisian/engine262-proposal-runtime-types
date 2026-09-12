import { BigIntValue, NumberValue, SymbolValue } from '../value.mts';
import type { TypeRecord } from './records.mts';
import { fitsNumericType } from './runtime.mts';
import { R } from '#self';

/**
 * Whether an untyped literal BELONGS at a type, and the reading of a type that
 * question needs.
 *
 * #sec-literal-types: a literal has an exact type of its own, and adapts to the
 * value type a position declares where its value is in range - which is why
 * `let n: uint8 = 5` is admitted where `IsAssignable` alone answers false. The
 * predicate is consulted before assignability wherever a literal meets a target:
 * a binding, an element, a parameter, an object member, a union arm.
 */

// Metadata erased: a ~parameterized~ record replaced by its base, through
// unions and intersections. This is exactly the view resolveType gave before
// it learnt to build ~parameterized~ records, and judging non-deferred shapes
// on it keeps this pass's diagnostics byte-identical to what they were: the
// one new judgment added here, the metadata subtype judgment, is the
// checking pass's, not this one's.
export const eraseMetadata = (t: TypeRecord, seen: Set<TypeRecord> = new Set()): TypeRecord => {
  // A member that is the union ITSELF terminates the walk.
  //
  // `type R = { a: int32 } | R` has no finite layout, and the declaration says
  // so - "R contains itself through field, so it has no finite layout", from
  // `FirstInlineCycle`. The LITERAL path never reached that message: it went
  // through `requireAssignable`, which erases both sides first, and this walk
  // recursed through [[Members]] with no guard until the HOST stack gave out.
  //
  // A RangeError is not a throw completion, so nothing downstream could catch
  // or report it - and it fired at CHECK time, so `if (false) { ... }` around
  // the literal did not avoid it either.
  //
  // Returning `t` on a revisit leaves the cycle in place for the comparison
  // that follows rather than pretending the type is finite. The comparison is
  // reached, answers, and the declaration's own diagnostic is what the program
  // sees.
  //
  // An ~object~ is returned untouched here as before, so the four shapes of
  // LEGITIMATE recursion - a nullable member, an array element, two aliases of
  // one shape, an interface - do not pass through this arm at all.
  if (t.Kind === 'parameterized') {
    return eraseMetadata(t.Base, seen);
  }
  if (t.Kind === 'union' || t.Kind === 'intersection') {
    if (seen.has(t)) {
      return t;
    }
    seen.add(t);
    return { Kind: t.Kind, Members: t.Members.map((m) => eraseMetadata(m, seen)) };
  }
  return t;
};

// #sec-contextual-types: a numeric literal whose value fits a numeric value
// type is assignable to it; the boundary constructs the typed value. This is
// the permanent contextual-typing rule (not a stopgap): after R1/R3 the value
// space is genuinely distinct, and this is how a plain literal enters it.
export const literalFitsNumericType = (sourceRaw: TypeRecord, targetRaw: TypeRecord, seen: Set<TypeRecord> = new Set()): boolean => {
  // `shared uint8` is `uint8` for the purpose of this rule. `IsSubtype` looks
  // through the marker (relations.mts), but a numeric literal reaches a
  // numeric type by CONVERSION rather than by subtyping, so this path has to
  // look through it as well, or `let s: shared uint8 = 1;` is refused the
  // moment the annotation resolves while the runtime converts and admits it.
  // Looking through here is what lets a `shared` annotation be resolved at
  // all rather than left unchecked to keep the peace.
  const source = sourceRaw.Kind === 'shared' ? sourceRaw.Target as TypeRecord : sourceRaw;
  const target = targetRaw.Kind === 'shared' ? targetRaw.Target as TypeRecord : targetRaw;
  if (source.Kind === 'literal' && target.Kind === 'primitive'
      && ['uint', 'int', 'float16', 'float32', 'float64', 'float128', 'bigint', 'rational'].includes(target.Name)
      && source.Value instanceof NumberValue
      && fitsNumericType(R(source.Value) as number, target.Name, target.Arguments)) {
    return true;
  }
  // A BigInt literal at `bigint` is the same rule with the other literal
  // kind: the value is already of the target type.
  if (source.Kind === 'literal' && target.Kind === 'primitive' && target.Name === 'bigint'
      && source.Value instanceof BigIntValue) {
    return true;
  }
  if (target.Kind === 'union') {
    // A union that contains ITSELF terminates here too. This is the
    // SECOND unguarded recursion over [[Members]] on this path: guarding
    // `eraseMetadata` alone moved the overflow rather than removing it, and
    // the frame count named this one next.
    //
    // `false` on a revisit is the honest answer - an arm already being asked
    // about supplies no new way for the literal to fit.
    if (seen.has(target)) {
      return false;
    }
    seen.add(target);
    return target.Members.some((m) => literalFitsNumericType(source, m, seen));
  }
  return false;
};

/**
 * Whether an index signature's KEY type admits this property name. A `string`
 * signature admits every string key; a literal or union key type admits the
 * names it names. Written against the key TYPE rather than testing a value,
 * since this pass has a name and not a value to test.
 */
export const keyAdmittedBy = (key: string | SymbolValue, keyType: TypeRecord): boolean => {
  if (typeof key !== 'string') {
    return keyType.Kind === 'primitive' && keyType.Name === 'symbol';
  }
  if (keyType.Kind === 'primitive') {
    return keyType.Name === 'string';
  }
  if (keyType.Kind === 'literal') {
    const v = keyType.Value as { stringValue?(): string };
    return typeof v?.stringValue === 'function' && v.stringValue() === key;
  }
  if (keyType.Kind === 'union') {
    return keyType.Members.some((m) => keyAdmittedBy(key, m));
  }
  return false;
};
