import type { ObjectValue, Value } from '../value.mts';
import type { TypeRecord } from './records.mts';
import { RegisterBoundTypeRecord } from './records.mts';

/**
 * proposal-runtime-types #sec-decorator-application: "A decorator is an
 * ordinary function whose last parameter is annotated with a reflection
 * context", and `@f`, `@f(0)`, and `@f('a')` "may name three declarations of f
 * and SELECT AMONG THEM THE WAY ANY CALL DOES".
 *
 * Selecting the way any call does means the ordinary overload machinery, which
 * resolves over argument VALUES by typing each through RuntimeTypeOf. So the
 * one thing that has to be true for decorator dispatch to work is that a
 * context object REPORTS its context type. It did not: it reported the plain
 * structural object type any object literal reports, no signature was viable,
 * and the LAST declaration ran.
 *
 * This is a STAMP rather than a shape test, and the distinction is the point.
 * Cycle 129 made membership structural - an object whose `kind` is "ClassField"
 * SATISFIES `Reflect.ClassField`, which is what decorators.md's writing of the
 * contexts as object shapes asks for. What a value REPORTS is a different
 * question from what it satisfies: an object literal reports its own shape and
 * satisfies every type it fits. Reading `kind` here instead would make every
 * `{ kind: "Class" }` in an unrelated program report a nominal type and stop
 * being assignable to the object types it is assignable to today.
 *
 * So the engine stamps the objects it BUILDS as reflections, and the stamp is
 * what RuntimeTypeOf reads. A hand-made object still satisfies the context; it
 * simply reports the shape it has.
 */

/** Every context by name, populated from the bindings Reflect is given. */
const contextRecords = new Map<string, TypeRecord>();

/** The stamp: the objects this engine built as reflections, and of what. */
const stamped = new WeakMap<ObjectValue, TypeRecord>();

/**
 * Register the contexts by reading them back off `Reflect`, where each is bound
 * under its own name. Reading them back rather than listing them again is
 * deliberate: a list here would be a second copy of the context table, and a
 * context added to `Reflect` without a matching line would dispatch as though
 * it did not exist - the drift F58 describes, in the place it is least visible.
 */
export function RegisterReflectionContexts(reflect: ObjectValue): void {
  const properties = (reflect as unknown as { properties?: Map<Value, { Value?: Value }> }).properties;
  if (!properties) {
    return;
  }
  for (const [key, descriptor] of properties) {
    const name = (key as unknown as { stringValue?: () => string }).stringValue?.();
    const held = descriptor?.Value as unknown as { TypeRecord?: TypeRecord } | undefined;
    const record = held?.TypeRecord;
    if (!name || !record) {
      continue;
    }
    // EVERY type `Reflect` binds, under the name a program writes for it, which
    // is qualified: an annotation says `Reflect.Region`, never `Region`.
    // `PLAN-checker-type-resolution.md stage A` - the checker's resolver refused
    // every qualified name outright, so all 47 of these were unresolvable to it
    // while the runtime resolved them by walking the binding.
    //
    // Registered before the context filter below, and without it: `Reflect.never`
    // is a type a program may write and is not a context, so a filter that keeps
    // only contexts would leave exactly that one name behind - which is what the
    // first attempt at this did.
    RegisterBoundTypeRecord(`Reflect.${name}`, record);
    if (record.Kind !== 'nominal') {
      continue;
    }
    const declaration = record.Declaration as unknown as { type?: string, name?: string };
    if (declaration?.type === 'ReflectionContext' && declaration.name === name) {
      contextRecords.set(name, record);
    }
  }
}

/**
 * Stamp an object as the reflection of `name`'s context. Called where the
 * reflection is built, beside the `kind` property that carries the same fact to
 * the program. A name with no registered context is ignored rather than
 * refused: the block family's sub-kinds all report `Block` today, and a stamp
 * is not the place to discover that.
 */
export function StampReflectionContext(object: ObjectValue, name: string): void {
  const record = contextRecords.get(name);
  if (record) {
    stamped.set(object, record);
  }
}

/** The context an object was built as a reflection of, if it was. */
export function ReflectionContextRecordOf(object: ObjectValue): TypeRecord | undefined {
  return stamped.get(object);
}
