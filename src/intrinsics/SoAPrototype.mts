import type { Realm } from '../execution-context/Realm.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  SoAProto_lengthGetter, SoAProto_capacityGetter, SoAProto_byteLengthGetter, SoAProto_reserve,
} from './SoA.mts';

/**
 * proposal-runtime-types soa.md: `%SoA.prototype%`.
 *
 * `length` is the ELEMENT count and not a column length, which is the whole
 * reason the field projections of a later stage live under `fields` rather than
 * on the container: a field named `length` or `push` then collides with
 * nothing.
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
export function bootstrapSoAPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['length', [SoAProto_lengthGetter]],
    ['capacity', [SoAProto_capacityGetter]],
    ['byteLength', [SoAProto_byteLengthGetter]],
    ['reserve', SoAProto_reserve, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'SoA');
  realmRec.Intrinsics['%SoA.prototype%'] = proto;
}
