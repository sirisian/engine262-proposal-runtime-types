import { Value } from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { Realm } from '#self';

/**
 * proposal-runtime-types #sec-type-errors: the prototype of the error a
 * DECIDABLE type violation produces.
 *
 * Its [[Prototype]] is `%SyntaxError.prototype%`, NOT `%Error.prototype%` -
 * which is what makes `e instanceof SyntaxError` true and keeps every existing
 * module-loader path that tests for one working unchanged. The constructor's
 * own [[Prototype]] is `%SyntaxError%` for the same reason, so the pair behaves
 * as a subclass written in the language would.
 */
export function bootstrapStaticTypeErrorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['name', Value('StaticTypeError')],
    ['message', Value('')],
  ], realmRec.Intrinsics['%SyntaxError.prototype%'], 'StaticTypeError');

  realmRec.Intrinsics['%StaticTypeError.prototype%'] = proto;
}
