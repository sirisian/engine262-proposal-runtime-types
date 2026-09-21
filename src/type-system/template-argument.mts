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

export function registerTemplateArgument(object: ObjectValue, cooked: readonly Value[]): void {
  templateObjects.set(object, templateArgumentType(cooked));
}

export function templateArgumentTypeOf(value: Value): TypeRecord | undefined {
  return templateObjects.get(value);
}
