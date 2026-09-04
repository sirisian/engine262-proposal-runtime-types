import { Value } from '../value.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { Realm } from '#self';

/**
 * proposal-runtime-types #sec-type-errors: the prototype of the error a
 * DECIDABLE type violation produces.
 *
 * Its [[Prototype]] is `%Error.prototype%`, so `StaticTypeError` sits directly
 * under `Error` exactly as every native error does and as
 * `WebAssembly.CompileError` - the closest analogue, a validation failure
 * distinct from a decode failure - also does.
 *
 * It deliberately does NOT extend `SyntaxError`. That was measured rather than
 * assumed: no module loader consulted branches on the class. Node's ESM
 * loader, its module translators and its CJS loader contain no reference to
 * `SyntaxError` at all, and the two real branches that exist would behave
 * identically either way - Node's REPL tests `e.name === 'SyntaxError'`, which
 * a `StaticTypeError` fails whatever it inherits from, and Vite's config
 * loader guards its `instanceof` with a message test that a type error does
 * not satisfy. Inheriting from `SyntaxError` would therefore have bought
 * nothing while making every existing `catch (e instanceof SyntaxError)`
 * silently start catching type errors.
 */
export function bootstrapStaticTypeErrorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['name', Value('StaticTypeError')],
    ['message', Value('')],
  ], realmRec.Intrinsics['%Error.prototype%'], 'StaticTypeError');

  realmRec.Intrinsics['%StaticTypeError.prototype%'] = proto;
}
