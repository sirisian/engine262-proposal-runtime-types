import type { Realm } from '../execution-context/Realm.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import {
  SoAProto_lengthGetter, SoAProto_capacityGetter, SoAProto_byteLengthGetter, SoAProto_reserve,
  SoAProto_push, SoAProto_pop, SoAProto_fill, SoAProto_toArray, SoAProto_fieldsGetter,
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
    ['fields', [SoAProto_fieldsGetter]],
    ['reserve', SoAProto_reserve, 1],
    ['push', SoAProto_push, 1],
    ['pop', SoAProto_pop, 0],
    ['fill', SoAProto_fill, 1],
    ['toArray', SoAProto_toArray, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'SoA');
  realmRec.Intrinsics['%SoA.prototype%'] = proto;
}
