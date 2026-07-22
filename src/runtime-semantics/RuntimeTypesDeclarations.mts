import { NumberValue, Value } from '../value.mts';
import { EnsureCompletion, Q, X } from '../completion.mts';
import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Evaluate, type PlainEvaluator, type ValueEvaluator } from '../evaluator.mts';
import { GetValue } from '../abstract-ops/all.mts';
import { GetTypeObject, isTypeObject } from '../type-system/intern.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { InstantiateGenericAlias, IsOfType, TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { builtinTypeRecord } from '../type-system/records.mts';
import { ConvertValue } from '../abstract-ops/runtime-types.mts';
import { InitializeBoundName } from './BindingInitialization.mts';
import { CreateDataPropertyOrThrow, OrdinaryFunctionCreate, R, RegisterMetaHook, RegisterTypeDefault, ResolveBinding, Throw, surroundingAgent } from '#self';

/**
 * proposal-runtime-types
 * Placeholder evaluation for the declarations introduced by the proposal: the
 * declared name is bound and initialized, and the declaration otherwise
 * evaluates to an empty completion. The type registry semantics that give the
 * bindings their values arrive with a later milestone.
 */
export function* Evaluate_RuntimeTypesBindingDeclaration(node: ParseNode.TypeAliasDeclaration | ParseNode.InterfaceDeclaration | ParseNode.EnumDeclaration): PlainEvaluator {
  const name = StringValue(node.BindingIdentifier);
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  let value: Value = Value.undefined;
  if (node.type === 'TypeAliasDeclaration') {
    if (node.TypeParameters) {
      // A generic alias binds uninstantiated; instantiation substitutes the
      // parameters and interns the result.
      value = GetTypeObject({ Kind: 'nominal', Declaration: node, Arguments: [] });
    } else {
      // #sec-gettypeobject: the alias binds the interned Type Object of its Type.
      const record = Q(yield* TypeNodeToTypeRecord(node.Type));
      if (node.WhereClauses && node.WhereClauses.length > 0) {
        // proposal-runtime-types (dependentrecordtypes.md): a `where` clause
        // makes this a dependent record type. Its identity is the declaration's
        // (two textually identical `where` blocks are two types), so it binds as
        // a nominal type whose structure is the base record; the predicates ride
        // on the declaration and are checked at every boundary by IsOfType.
        value = GetTypeObject({
          Kind: 'nominal', Declaration: node, Arguments: [], Structure: record,
        });
      } else {
        value = GetTypeObject(record);
      }
    }
  } else if (node.type === 'EnumDeclaration') {
    // Enum members take their initializer's value, or the previous numeric
    // value plus one, starting from 0. The members are data properties of the
    // enum's Type Object, and membership is SameValue against the list.
    const memberValues: Value[] = [];
    const memberNames: string[] = [];
    let nextAuto = 0;
    for (const member of node.EnumMemberList) {
      let v: Value;
      if (member.Initializer) {
        const ref = Q(yield* Evaluate(member.Initializer));
        v = Q(yield* GetValue(ref));
      } else {
        v = Value(nextAuto);
      }
      if (v instanceof NumberValue) {
        nextAuto = (R(v) as number) + 1;
      } else {
        nextAuto += 1;
      }
      memberValues.push(v);
      memberNames.push(member.IdentifierName.name);
    }
    const record: TypeRecord = {
      Kind: 'nominal', Declaration: node, Arguments: [], EnumMembers: memberValues,
    };
    const obj = GetTypeObject(record);
    for (let i = 0; i < memberNames.length; i += 1) {
      X(CreateDataPropertyOrThrow(obj, Value(memberNames[i]), memberValues[i]));
    }
    value = obj;
  } else if (node.type === 'InterfaceDeclaration') {
    // The interface's structural shape: annotated members check their type,
    // method signatures check callability, and a member whose type cannot be
    // resolved checks presence only. Operators and index signatures join with
    // a later milestone.
    // The interface's structure is a real ~object~ record now; membership
    // rides the structural IsOfType case, while identity stays nominal.
    const Properties: { key: string, type: TypeRecord, optional: boolean, readonly: boolean }[] = [];
    for (const member of node.InterfaceMemberList) {
      if (member.type !== 'TypeMember') {
        continue;
      }
      const m = member as unknown as { PropertyName?: { name?: string, value?: string }, Readonly?: boolean, Optional?: boolean, TypeAnnotation?: ParseNode.TypeAnnotation | null, MethodSignature?: unknown };
      const key = m.PropertyName?.name ?? m.PropertyName?.value;
      if (typeof key !== 'string') {
        continue;
      }
      let resolved: TypeRecord = { Kind: 'any' };
      if (m.TypeAnnotation) {
        const attempt = EnsureCompletion(yield* TypeNodeToTypeRecord(m.TypeAnnotation.Type));
        if (attempt.Type === 'normal') {
          resolved = attempt.Value as TypeRecord;
        }
      } else if (m.MethodSignature) {
        resolved = { Kind: 'function', Signatures: [] };
      }
      Properties.push({ key, type: resolved, optional: !!m.Optional, readonly: !!m.Readonly });
    }
    const record: TypeRecord = {
      Kind: 'nominal',
      Declaration: node,
      Arguments: [],
      Structure: { Kind: 'object', Properties, IndexSignatures: [] },
    };
    value = GetTypeObject(record);
  }
  Q(yield* InitializeBoundName(name, value, env));
  return undefined;
}

/**
 * proposal-runtime-types
 * Evaluation of the expression forms: `is` is the IsOfType membership test,
 * `:=` applies the conversion rule, and `type` produces the interned Type
 * Object.
 */
export function* Evaluate_IsExpression({ Expression, Type }: ParseNode.IsExpression): ValueEvaluator {
  const ref = Q(yield* Evaluate(Expression));
  const value = Q(yield* GetValue(ref));
  const record = Q(yield* TypeNodeToTypeRecord(Type));
  const result = Q(yield* IsOfType(value, record));
  return result ? Value.true : Value.false;
}

export function* Evaluate_TypedConversionExpression({ Expression, Type }: ParseNode.TypedConversionExpression): ValueEvaluator {
  const ref = Q(yield* Evaluate(Expression));
  const value = Q(yield* GetValue(ref));
  const record = Q(yield* TypeNodeToTypeRecord(Type));
  return Q(yield* ConvertValue(value, record));
}

export function* Evaluate_TypeOperatorExpression({ Type }: ParseNode.TypeOperatorExpression): ValueEvaluator {
  const record = Q(yield* TypeNodeToTypeRecord(Type));
  return GetTypeObject(record);
}
/**
 * proposal-runtime-types #sec-meta-hooks: evaluate the `default` hook and
 * register it against the named type's interned Type Object.
 */
export function* Evaluate_MetaDeclaration(node: ParseNode.MetaDeclaration): PlainEvaluator {
  if (node.TypeName.MemberNames.length > 0) {
    return undefined;
  }
  const name = node.TypeName.IdentifierReference.name;
  const record = builtinTypeRecord(name);
  let typeObject: Value | null = record ? GetTypeObject(record) : null;
  if (!typeObject) {
    const ref = Q(yield* ResolveBinding(Value(name)));
    const candidate = Q(yield* GetValue(ref));
    typeObject = isTypeObject(candidate) ? candidate : null;
  }
  if (!typeObject) {
    return undefined;
  }
  let sawDefault = false;
  for (const hook of node.MetaHookList) {
    if (hook.type === 'MetaDefaultHook') {
      const ref = Q(yield* Evaluate(hook.AssignmentExpression));
      const v = Q(yield* GetValue(ref));
      RegisterTypeDefault(typeObject, v);
      sawDefault = true;
    } else {
      const hookName = (hook as { ClassElementName?: { name?: string } }).ClassElementName?.name;
      const body = (hook as { FunctionBody?: ParseNode.FunctionBody | null }).FunctionBody;
      const params = (hook as { UniqueFormalParameters?: ParseNode.FormalParameters }).UniqueFormalParameters;
      if (typeof hookName === 'string' && body && params) {
        const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
        const privEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
        const fn = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%Function.prototype%'), 'meta hook', params, body, 'non-lexical-this', env, privEnv);
        RegisterMetaHook(typeObject, hookName, fn);
      }
    }
  }
  // #sec-meta-hooks: `default` is required.
  if (!sawDefault) {
    return Throw.TypeError('$1 is not supported yet', Value(`a meta declaration for ${name} without a default hook`));
  }
  return undefined;
}

/**
 * proposal-runtime-types M17: MemberExpression/CallExpression TypeArguments.
 * A generic alias Type Object specializes; any other base keeps its Reference
 * so member calls retain their this binding.
 */
export function* Evaluate_TypeArgumentsExpression(node: ParseNode.TypeArgumentsExpression): PlainEvaluator<unknown> {
  const ref = yield* Evaluate(node.Expression);
  const inspected = EnsureCompletion(ref);
  if (inspected.Type !== 'normal') {
    return ref;
  }
  const peeked = EnsureCompletion(yield* GetValue(inspected.Value as never));
  if (peeked.Type !== 'normal') {
    return ref;
  }
  const value = peeked.Value;
  if (isTypeObject(value)) {
    const record = value.TypeRecord;
    if (record.Kind === 'nominal' && record.Declaration.type === 'TypeAliasDeclaration' && (record.Declaration as ParseNode.TypeAliasDeclaration).TypeParameters) {
      const argRecords: TypeRecord[] = [];
      for (const argNode of node.TypeArguments.TypeArgumentList) {
        argRecords.push(Q(yield* TypeNodeToTypeRecord(argNode)));
      }
      const instantiated = Q(yield* InstantiateGenericAlias(record.Declaration as ParseNode.TypeAliasDeclaration, argRecords));
      return GetTypeObject(instantiated);
    }
  }
  return ref;
}
