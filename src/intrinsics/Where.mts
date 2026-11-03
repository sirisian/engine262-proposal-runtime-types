import { ObjectValue, Value, type Arguments } from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { type TypeRecord, anyType } from '../type-system/records.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import { EvaluateWherePredicate } from '../type-system/where-predicates.mts';
import { ClaimMetaKey, CreateBuiltinFunction, Get, HasOwnProperty, RegisterMetaHook, RegisterMetaShape,
  RegisterMetaDefaultSnapshot, RegisterMetaTypeName, surroundingAgent, type Realm } from '#self';

const owners = new WeakSet<object>();
export function IsWhereMetaType(owner: object): boolean {
  return owners.has(owner);
}

function* Where_validate([value = Value.undefined, metadata = Value.undefined]: Arguments): ValueEvaluator {
  if (!(metadata instanceof ObjectValue) || Q(yield* HasOwnProperty(metadata, Value('where'))) === Value.false) return Value.true;
  const predicate = Q(yield* Get(metadata, Value('where')));
  if (!(predicate instanceof ObjectValue)) return Value.false;
  const holds = Q(yield* EvaluateWherePredicate(predicate, value));
  return holds ? Value.true : Value.false;
}
function* Where_subtype([a = Value.undefined, b = Value.undefined]: Arguments): ValueEvaluator {
  if (!(b instanceof ObjectValue) || Q(yield* HasOwnProperty(b, Value('where'))) === Value.false) return Value.true;
  if (!(a instanceof ObjectValue) || Q(yield* HasOwnProperty(a, Value('where'))) === Value.false) return Value.false;
  const left = Q(yield* Get(a, Value('where')));
  const right = Q(yield* Get(b, Value('where')));
  return left === right ? Value.true : Value.false;
}
export function bootstrapWhere(realm: Realm): void {
  if (!surroundingAgent.feature('runtime-types')) return;
  const shape: TypeRecord = { Kind: 'object', Properties: [{ key: 'where', type: anyType, optional: true, readonly: false }], IndexSignatures: [] };
  const owner = GetTypeObject(shape, realm);
  owners.add(owner);
  ClaimMetaKey('where', owner);
  RegisterMetaShape(owner, shape);
  RegisterMetaTypeName(owner, 'Where');
  RegisterMetaDefaultSnapshot(owner, Object.freeze(Object.create(null)) as Value);
  RegisterMetaHook(owner, 'validate', X(CreateBuiltinFunction(Where_validate, 2, Value('validate'), [], realm)));
  RegisterMetaHook(owner, 'subtype', X(CreateBuiltinFunction(Where_subtype, 2, Value('subtype'), [], realm)));
}
