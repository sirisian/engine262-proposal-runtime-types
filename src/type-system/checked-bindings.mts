import { SameType } from './relations.mts';
import type { TypeRecord } from './records.mts';
import { resolvedDeclaration, declarationModuleEnvironment } from './resolving-aliases.mts';
import {
  type EnvironmentRecord, LexicalClassFamily, ClassFamilyIdentityOf, ClassTypeEnvironmentOf,
  SpecializedClassConstructor, LookupClassType, isTypeObject,
} from '#self';

/** Instantiate checked declaration dependencies in this call's lexical context.
 * The shared checking result stays symbolic. No argument value, property access,
 * specialization evaluation or mutable source-name lookup supplies an identity.
 */
export function InstantiateCheckedBindings(bindings: ReadonlyMap<string, TypeRecord>,
  environment: EnvironmentRecord, application?: TypeRecord): Map<string, TypeRecord> {
  const contexts = new Map<EnvironmentRecord, Map<TypeRecord, TypeRecord>>();
  const walk = (type: TypeRecord, context = environment): TypeRecord => {
    let seen = contexts.get(context);
    if (!seen) contexts.set(context, seen = new Map());
    const prior = seen.get(type);
    if (prior) return prior;
    // A completed nominal has its own captured context. Never rebind it to an
    // activation of the same source declaration visible at this call.
    if (type.Kind === 'nominal' && !type.LibraryName && (type.DeclarationIdentity || type.Constructor)
      && !(application?.Kind === 'nominal' && type.Declaration === application.Declaration
        && type.DeclarationIdentity === application.DeclarationIdentity)) return type;
    const copy = { ...type };
    seen.set(type, copy);
    switch (copy.Kind) {
      case 'nominal': {
        copy.Arguments = copy.Arguments.map((argument) => typeof argument === 'number' ? argument : walk(argument, context));
        if (copy.Declaration.type === 'InterfaceDeclaration') {
          let published = resolvedDeclaration(context, copy.Declaration);
          if (!published) {
            const source = declarationModuleEnvironment(context, copy.Declaration);
            if (source) published = resolvedDeclaration(source, copy.Declaration);
          }
          if (published?.Kind === 'nominal' && published.DeclarationIdentity) {
            copy.DeclarationIdentity = published.DeclarationIdentity;
          }
          break;
        }
        if (copy.Declaration.type !== 'ClassDeclaration' && copy.Declaration.type !== 'ClassExpression') break;
        // A specialization being verified has an actual identity and a local
        // interface graph, but deliberately has no published success record.
        if (application?.Kind === 'nominal' && copy.Declaration === application.Declaration
          && copy.Arguments.length === application.Arguments.length
          && copy.Arguments.every((argument, i) => typeof argument === 'number' || typeof application.Arguments[i] === 'number'
            ? argument === application.Arguments[i] : SameType(argument, application.Arguments[i] as TypeRecord))) {
          copy.Constructor = application.Constructor;
          copy.DeclarationIdentity = application.DeclarationIdentity;
          copy.Base = application.Base;
          copy.Implements = application.Implements;
          break;
        }
        let family = LexicalClassFamily(copy.Declaration, context);
        if (!family) {
          const source = declarationModuleEnvironment(context, copy.Declaration);
          if (source) family = LexicalClassFamily(copy.Declaration, source);
        }
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
        // An open family's runtime list deliberately omits dependent targets.
        // It cannot replace the checked declaration's parameterized contracts
        // with an empty completed relation. Only a concrete specialization (or
        // a nongeneric class) supplies the completed runtime list. This step
        // completes identities; it does not evaluate a specialization.
        if (constructor !== family || !copy.Declaration.TypeParameters?.TypeParameterList.length) {
          copy.Implements = runtime.Implements;
        } else {
          copy.Implements = copy.Implements?.map((target) => walk(target, ClassTypeEnvironmentOf(family) ?? context));
        }
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
