import type { Realm } from './Realm.mts';
import { DeclarativeEnvironmentRecord } from './Environment.mts';
import {
  Value, X, surroundingAgent, type JSStringValue,
} from '#self';

/**
 * proposal-runtime-types `#sec-type-names`: the environment the built-in type
 * names live in.
 *
 * They are NOT global object properties. The clause makes admitting a property of
 * the SOURCE TEXT, and a global property is one object shared by every Script and
 * Module of a realm - so binding them there would change `typeof string` in a
 * hundred untyped scripts because one typed module was loaded beside them, which
 * is the outcome the clause exists to prevent.
 *
 * Instead this environment sits outside the scope chain and is consulted only at
 * its terminal step (`GetIdentifierReference`), which is the clause's "through
 * the built-in table only where no user binding of the name exists": a program's
 * own declaration is found first, by the ordinary walk, and never reaches here.
 */
const typeNameEnvironments = new WeakMap<Realm, DeclarativeEnvironmentRecord>();

export function SetTypeNameEnvironment(realmRec: Realm, env: DeclarativeEnvironmentRecord): void {
  typeNameEnvironments.set(realmRec, env);
}

export function TypeNameEnvironmentFor(realmRec: Realm | undefined): DeclarativeEnvironmentRecord | undefined {
  return realmRec ? typeNameEnvironments.get(realmRec) : undefined;
}

/** Bind one name into the realm's type-name environment. */
export function BindTypeName(realmRec: Realm, name: string, value: Value): void {
  let env = typeNameEnvironments.get(realmRec);
  if (!env) {
    env = new DeclarativeEnvironmentRecord(null);
    typeNameEnvironments.set(realmRec, env);
  }
  const n = Value(name) as JSStringValue;
  env.CreateImmutableBinding(n, Value.true);
  X(env.InitializeBinding(n, value));
}

/**
 * Whether the source text now running admits type names.
 *
 * `#sec-type-names`: the property is fixed when the text is parsed and is not
 * established by anything that happens while it runs, so this is a read of a
 * recorded flag rather than a computation. A direct `eval` takes the state of the
 * text it runs inside, which falls out of it sharing that text's
 * [[ScriptOrModule]]; an indirect `eval` and the `Function` constructor take the
 * state of the text they are called from, which is the same read.
 */
export function RunningSourceTextAdmitsTypeNames(): boolean {
  const ctx = surroundingAgent.runningExecutionContext;
  if (!ctx) {
    return false;
  }
  // A context may carry its own answer, and where it does that answer is
  // AUTHORITATIVE rather than an override: `eval` and `Function` produce source
  // texts that [[ScriptOrModule]] does not name, and a dynamic function's
  // [[ScriptOrModule]] is the text that CREATED it - so falling through to it
  // would let `Function("return typeof string")` admit because its caller did,
  // which is exactly the inheritance #sec-type-names denies an indirect form.
  const own = (ctx as { AdmitsTypeNames?: boolean }).AdmitsTypeNames;
  if (own !== undefined) {
    return own;
  }
  const unit = ctx.ScriptOrModule as { AdmitsTypeNames?: boolean } | null | undefined;
  if (unit && unit.AdmitsTypeNames === true) {
    return true;
  }
  // A console evaluates each entry as its own Script, and carries the session's
  // state by setting that Script's flag before it runs (see the inspector), so
  // there is nothing further to consult here.
  return false;
}
