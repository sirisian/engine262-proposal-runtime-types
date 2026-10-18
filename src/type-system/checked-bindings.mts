import type { TypeRecord } from './records.mts';
import {
  type EnvironmentRecord, LexicalClassFamily, ClassFamilyIdentityOf, ClassTypeEnvironmentOf,
  SpecializedClassConstructor, LookupClassType, isTypeObject,
} from '#self';

/** Instantiate checked declaration dependencies in this call's lexical context.
 * The shared checking result stays symbolic. No argument value, property access,
 * specialization evaluation or mutable source-name lookup supplies an identity.
 */
export function InstantiateCheckedBindings(bindings: ReadonlyMap<string, TypeRecord>,
  environment: EnvironmentRecord): Map<string, TypeRecord> {
  const contexts = new Map<EnvironmentRecord, Map<TypeRecord, TypeRecord>>();
  const walk = (type: TypeRecord, context = environment): TypeRecord => {
    let seen = contexts.get(context);
    if (!seen) contexts.set(context, seen = new Map());
    const prior = seen.get(type);
    if (prior) return prior;
    // A completed nominal has its own captured context. Never rebind it to an
    // activation of the same source declaration visible at this call.
    if (type.Kind === 'nominal' && (type.DeclarationIdentity || type.Constructor)) return type;
    const copy = { ...type };
    seen.set(type, copy);
    switch (copy.Kind) {
      case 'nominal': {
        copy.Arguments = copy.Arguments.map((argument) => typeof argument === 'number' ? argument : walk(argument, context));
        if (copy.Declaration.type !== 'ClassDeclaration') break;
        const family = LexicalClassFamily(copy.Declaration, context);
        if (!family) break;
        const constructor = SpecializedClassConstructor(copy.Declaration, copy.Arguments, family) ?? family;
        const object = LookupClassType(constructor);
        const runtime = isTypeObject(object) && object.TypeRecord;
        if (!runtime || runtime.Kind !== 'nominal' || runtime.Declaration !== copy.Declaration) break;
        copy.Constructor = constructor;
        copy.DeclarationIdentity = ClassFamilyIdentityOf(family);
        // Heritage belongs to the evaluated family, including captured bases.
        // Subtyping substitutes this application's arguments in that base.
        copy.Base = runtime.Base && walk(runtime.Base, ClassTypeEnvironmentOf(family) ?? context);
        copy.Implements = runtime.Implements;
        break;
      }
      case 'array':
        copy.Element = walk(copy.Element, context);
        if (typeof copy.Extent === 'object') copy.Extent = walk(copy.Extent, context);
        break;
      case 'tuple':
        copy.Elements = copy.Elements.map((entry) => ({ ...entry, Type: walk(entry.Type, context) }));
        break;
      case 'union': case 'intersection':
        copy.Members = copy.Members.map((member) => walk(member, context));
        break;
      case 'reference': case 'shared':
        copy.Target = walk(copy.Target, context);
        break;
      case 'parameterized':
        copy.Base = walk(copy.Base, context);
        break;
      case 'object':
        copy.Properties = copy.Properties.map((property) => ({ ...property, type: walk(property.type, context),
          ...(property.writeType ? { writeType: walk(property.writeType, context) } : {}) }));
        copy.IndexSignatures = copy.IndexSignatures.map((index) => ({ ...index, Key: walk(index.Key, context), Value: walk(index.Value, context) }));
        break;
      case 'function':
        copy.Signatures = copy.Signatures.map((signature) => ({ ...signature,
          Parameters: signature.Parameters.map((parameter) => ({ ...parameter, Type: walk(parameter.Type, context) })),
          Return: signature.Return && walk(signature.Return, context),
          ...(signature.InferredReturn ? { InferredReturn: walk(signature.InferredReturn, context) } : {}),
          ...(signature.ThisType ? { ThisType: walk(signature.ThisType, context) } : {}),
          ...(signature.Narrows ? { Narrows: signature.Narrows.map((narrow) => ({ ...narrow, Type: walk(narrow.Type, context) })) } : {}),
        }));
        break;
      default:
        // Leaves and independently scoped declaration/default computations are
        // retained, including parameter identities and metadata values.
        seen.set(type, type);
        return type;
    }
    return copy;
  };
  return new Map([...bindings].map(([name, type]) => [name, walk(type)]));
}
