import { Value, ObjectValue, ReferenceRecord } from '../value.mts';
import { EnforceAnnotation, IsOfTypeNode } from '../abstract-ops/runtime-types.mts';
import { CreateRefBinding, RefBindingHolder } from '../execution-context/Environment.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { NormalCompletion } from '../completion.mts';
import { Evaluate } from '../evaluator.mts';
import { StringValue, IsAnonymousFunctionDefinition } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { SoAElementLocationFor } from './RefExpression.mts';
import {
  NamedEvaluation,
  BindingInitialization,
} from './all.mts';
import {
  GetV,
  GetValue,
  PutValue,
  ResolveBinding,
  InitializeReferencedBinding,
} from '#self';
import type {
  EnvironmentRecord, FunctionDeclaration, PropertyKeyValue, UndefinedValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-runtime-semantics-keyedbindinginitialization */
export function* KeyedBindingInitialization(node: ParseNode.BindingElement | ParseNode.SingleNameBinding, value: Value, environment: EnvironmentRecord | UndefinedValue, propertyName: PropertyKeyValue) {
  if (node.type === 'BindingElement') {
    // 1. Let v be ? GetV(value, propertyName).
    let v = Q(yield* GetV(value, propertyName));
    // 2. If Initializer is present and v is undefined, then
    if (node.Initializer && v === Value.undefined) {
      // a. Let defaultValue be the result of evaluating Initializer.
      const defaultValue = Q(yield* Evaluate(node.Initializer));
      // b. Set v to ? GetValue(defaultValue).
      v = Q(yield* GetValue(defaultValue));
    }
    // 2. Return the result of performing BindingInitialization for BindingPattern passing v and environment as arguments.
    return yield* BindingInitialization(node.BindingPattern, v, environment);
  } else {
    // 1. Let bindingId be StringValue of BindingIdentifier.
    const bindingId = StringValue(node.BindingIdentifier);
    // 2. Let lhs be ? ResolveBinding(bindingId, environment).
    const lhs = Q(yield* ResolveBinding(bindingId, environment, node.BindingIdentifier.strict));
    // 3. Let v be ? GetV(value, propertyName).
    let v = Q(yield* GetV(value, propertyName));
    if (node.Initializer && v === Value.undefined) {
      // a. If IsAnonymousFunctionDefinition(Initializer) is true, then
      if (IsAnonymousFunctionDefinition(node.Initializer)) {
        // i. Set v to the result of performing NamedEvaluation for Initializer with argument bindingId.
        v = (yield* NamedEvaluation(node.Initializer as FunctionDeclaration, bindingId)) as Value;
      } else { // b. Else,
        // i. Let defaultValue be the result of evaluating Initializer.
        const defaultValue = Q(yield* Evaluate(node.Initializer));
        // ii. Set v to ? GetValue(defaultValue).
        v = Q(yield* GetValue(defaultValue));
      }
    }
    // proposal-runtime-types #sec-typed-destructuring: a `ref` member borrows
    // the LOCATION of the property on the object being destructured, rather
    // than taking its value. The borrow is of the object's own storage, which
    // is why `g(o)` suffices and `g(ref o)` is not required - lending the
    // caller's variable would be a different thing entirely, and a pattern
    // parameter decays a reference argument before the pattern is applied.
    if (node.Ref === true) {
      if (!(value instanceof ObjectValue)) {
        return Throw.TypeError('cannot take a ref of a property of a primitive');
      }
      const location = new ReferenceRecord({
        Base: value,
        ReferencedName: propertyName,
        Strict: Value.true,
        ThisValue: undefined,
        IndexOperator: undefined,
        IndexSetOperator: undefined,
        SoAElement: undefined,
      });
      if (node.TypeAnnotation) {
        const referent = Q(yield* GetValue(location));
        const ok = Q(yield* IsOfTypeNode(referent, node.TypeAnnotation.Type));
        if (!ok) {
          return Throw.TypeError('the value bound by ref to $1 does not satisfy its type annotation', bindingId);
        }
      }
      // The holder is found the way a `ref` lexical binding finds it, so a
      // pattern at the top level of a script reaches the same binding the
      // declaration created rather than being refused for the shape of its
      // environment.
      const holder = lhs.Base !== 'unresolvable' && typeof (lhs.Base as { HasBinding?: unknown }).HasBinding === 'function'
        ? RefBindingHolder(lhs.Base as EnvironmentRecord, bindingId)
        : undefined;
      if (holder === undefined) {
        return Throw.TypeError('$1 cannot be bound by ref here', bindingId);
      }
      const mutable = holder.bindings.get(bindingId)?.mutable !== false;
      CreateRefBinding(holder, bindingId, Q(yield* SoAElementLocationFor(location)), mutable);
      return NormalCompletion(undefined);
    }
    // proposal-runtime-types #sec-typed-destructuring: a member's annotation is
    // enforced at the binding boundary, as an annotated binding's is.
    if (node.TypeAnnotation) {
      v = Q(yield* EnforceAnnotation(node.TypeAnnotation, v));
    }
    // 5. If environment is undefined, return ? PutValue(lhs, v).
    if (environment === Value.undefined) {
      return Q(yield* PutValue(lhs, v));
    }
    // 6. Return InitializeReferencedBinding(lhs, v).
    return yield* InitializeReferencedBinding(lhs, v);
  }
}
