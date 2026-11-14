import { Value, type ObjectValue } from '../value.mts';
import { makePrimitive, type TypeRecord } from './records.mts';

// Call-site facts about the language-created, frozen template object. These
// neither stamp a storage type nor change reflection, identity or allocation.
const templateTypes = new WeakSet<TypeRecord>();
const templateObjects = new WeakMap<object, TypeRecord>();

export function templateArgumentType(cooked: readonly Value[]): TypeRecord {
  const type: TypeRecord = { Kind: 'tuple', Elements: cooked.map((value) => ({
    Type: value === Value.undefined ? makePrimitive('undefined')
      : { Kind: 'literal', Base: makePrimitive('string'), Value: value } as TypeRecord,
    Rest: false, Initial: 'none',
  })) };
  templateTypes.add(type);
  return type;
}

export function isTemplateArgumentType(type: TypeRecord): boolean {
  return templateTypes.has(type);
}

/**
 * What the template object has beside its cooked strings: `raw`, a frozen
 * array of strings. A tag function's first parameter is an array type with
 * that member - `interface TemplateStringsArray extends [].<string | undefined>
 * { readonly raw: [].<string>; }`, or the intersection that spells the same type - and
 * the strings argument of a tagged template satisfies it.
 */
const templateMembers: TypeRecord = {
  Kind: 'object',
  Properties: [{
    // `raw` is read-only, as the object is: it is frozen where it is made.
    // The design declares `readonly raw: [].<string>`, and a type that asks
    // for a writable `raw` is not met by a template, whose `raw` cannot be
    // written.
    key: 'raw', type: { Kind: 'array', Element: makePrimitive('string'), Extent: 'dynamic' } as TypeRecord, optional: false, readonly: true,
  }],
  IndexSignatures: [],
} as unknown as TypeRecord;
export function templateMembersType(): TypeRecord {
  return templateMembers;
}

export function registerTemplateArgument(object: ObjectValue, cooked: readonly Value[]): void {
  templateObjects.set(object, templateArgumentType(cooked));
}

export function templateArgumentTypeOf(value: Value): TypeRecord | undefined {
  return templateObjects.get(value);
}
