import {
  NullValue, ObjectValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import { Q, X, type ValueCompletion } from '../completion.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { assignProps } from './bootstrap.mts';
import {
  surroundingAgent,
} from '#self';
import {
  Assert,
  CreateBuiltinFunction,
  CreateDataProperty,
  markBuiltinFunctionAsConstructor,
  OrdinaryObjectCreate,
  ProxyCreate,
  Realm,
  Throw,
  type BuiltinFunctionObject,
  type ExoticObject,
  type FunctionObject,
} from '#self';

export interface ProxyObject extends ExoticObject, BuiltinFunctionObject {
  ProxyHandler: Value | NullValue;
  ProxyTarget: ObjectValue | NullValue;
}
export function isProxyExoticObject(O: Value): O is ProxyObject {
  return 'ProxyHandler' in O;
}
export interface RevocableProxyRevokeFunctionObject extends BuiltinFunctionObject {
  RevocableProxy: ProxyObject | NullValue;
}
/** https://tc39.es/ecma262/#sec-proxy-target-handler */
/**
 * The type argument a construction supplied, set by the NewExpression intercept.
 *
 * proposal-runtime-types #sec-reflection-and-declared-types: "A Proxy
 * constructed with a type argument _T_ has a [[RuntimeType]] internal slot whose
 * value is _T_'s Type Record, so `Reflect.typeOf` reports _T_ rather than the
 * shape of its target, and its traps are checked against _T_."
 */
let pendingRuntimeType: TypeRecord | undefined;
export function SetPendingProxyRuntimeType(t: TypeRecord | undefined): void {
  pendingRuntimeType = t;
}

function ProxyConstructor(this: FunctionObject, [target = Value.undefined, handler = Value.undefined]: Arguments, { NewTarget }: FunctionCallContext) {
  // Read and CLEAR before anything can fail, so a refused construction leaves
  // nothing for the next one to pick up.
  const declared = pendingRuntimeType;
  pendingRuntimeType = undefined;
  // 1. f NewTarget is undefined, throw a TypeError exception.
  if (NewTarget === Value.undefined) {
    return Throw.TypeError('Proxy cannot be invoked without new');
  }
  // 2. Return ? ProxyCreate(target, handler).
  const created = ProxyCreate(target, handler);
  // A normal completion here IS the value rather than a record wrapping one, so
  // the slot is set on an ObjectValue and a throw passes through untouched.
  if (declared !== undefined && created instanceof ObjectValue) {
    (created as unknown as { RuntimeType?: TypeRecord }).RuntimeType = declared;
  }
  return created;
}

/** https://tc39.es/ecma262/#sec-proxy-revocation-functions */
function ProxyRevocationFunctions() {
  // 1. Let F be the active function object.
  const F = surroundingAgent.activeFunctionObject as RevocableProxyRevokeFunctionObject;
  // 2. Let p be F.[[RevocableProxy]].
  const p = F.RevocableProxy;
  // 3. If p is null, return undefined.
  if (p === Value.null) {
    return Value.undefined;
  }
  // 4. Set F.[[RevocableProxy]] to null.
  F.RevocableProxy = Value.null;
  // 5. Assert: p is a Proxy object.
  Assert(isProxyExoticObject(p));
  // 6. Set p.[[ProxyTarget]] to null.
  p.ProxyTarget = Value.null;
  // 7. Set p.[[ProxyHandler]] to null.
  p.ProxyHandler = Value.null;
  // 8. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-proxy.revocable */
function Proxy_revocable([target = Value.undefined, handler = Value.undefined]: Arguments): ValueCompletion {
  // 1. Let p be ? ProxyCreate(target, handler).
  const p = Q(ProxyCreate(target, handler));
  /** https://tc39.es/ecma262/#sec-proxy-revocation-functions. */
  const steps = ProxyRevocationFunctions;
  // 3. Let length be the number of non-optional parameters of the function definition in Proxy Revocation Functions.
  const length = 0;
  // 4. Let revoker be ! CreateBuiltinFunction(steps, length, "", « [[RevocableProxy]] »).
  const revoker = X(CreateBuiltinFunction(steps, length, Value(''), ['RevocableProxy'])) as RevocableProxyRevokeFunctionObject;
  // 5. Set revoker.[[RevocableProxy]] to p.
  revoker.RevocableProxy = p;
  // 6. Let result be OrdinaryObjectCreate(%Object.prototype%).
  const result = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  // 7. Perform ! CreateDataPropertyOrThrow(result, "proxy", p).
  X(CreateDataProperty(result, Value('proxy'), p));
  // 8. Perform ! CreateDataPropertyOrThrow(result, "revoke", revoker).
  X(CreateDataProperty(result, Value('revoke'), revoker));
  // 9. Return result.
  return result;
}

export function bootstrapProxy(realmRec: Realm) {
  const proxyConstructor = CreateBuiltinFunction(
    markBuiltinFunctionAsConstructor(ProxyConstructor),
    2,
    Value('Proxy'),
    [],
    realmRec,
  );

  assignProps(realmRec, proxyConstructor, [
    ['revocable', Proxy_revocable, 2],
  ]);

  realmRec.Intrinsics['%Proxy%'] = proxyConstructor;
  realmRec.Intrinsics['%Proxy.revocable%'] = proxyConstructor.properties.get(Value('revocable'))!.Value as ObjectValue;
}
