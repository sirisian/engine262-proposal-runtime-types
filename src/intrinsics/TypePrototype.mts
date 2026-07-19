import { Q } from '../completion.mts';
import { Value, type Arguments, type FunctionCallContext } from '../value.mts';
import { isTypeObject } from '../type-system/intern.mts';
import { IsOfType } from '../type-system/runtime.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { Realm, Throw, wellKnownSymbols } from '#self';

/**
 * proposal-runtime-types: %Type.prototype%, the prototype of every Type
 * Object. Its %Symbol.hasInstance% method makes `value instanceof T` the
 * IsOfType membership test.
 */
/** https://sirisian.github.io/ecmascript-types/#sec-isoftype */
function* TypeProto_hasInstance([V = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
  if (!isTypeObject(thisValue)) {
    return Throw.TypeError('$1 is not a type', thisValue);
  }
  const result = Q(yield* IsOfType(V, thisValue.TypeRecord));
  return result ? Value.true : Value.false;
}

export function bootstrapTypePrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    [wellKnownSymbols.hasInstance, TypeProto_hasInstance, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Type');
  realmRec.Intrinsics['%Type.prototype%'] = proto;
}
