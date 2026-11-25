/**
 * Question AP, AP2: the members a built-in constructor gives the instances of
 * a class that extends it (#sec-library-instance-members).
 *
 * A typed class's instances are sealed, so a store to a member no declaration
 * names cannot add it, and a call of one calls *undefined* (#sec-typed-storage).
 * A class whose base is a built-in has the built-in's members too, and the
 * checker judged none of its stores or calls, since it did not know them: a
 * misspelled member was refused only when the store ran, and a call of one
 * only when it was made. This table lists, for each built-in a class may
 * extend whose instances are ordinary objects with internal slots, the members
 * its instances have.
 *
 * - `instance`: the own properties its constructor gives EVERY instance as
 *   writable data properties. A store to one succeeds on a sealed instance.
 * - `optional`: the own properties its constructor gives an instance only where
 *   it was given them, `message` and `cause` of an error. A sealed instance
 *   made without one cannot gain it, so a store to one may fail.
 * - `prototype`: the String-keyed properties of its prototype object, as
 *   ECMA-262 and the proposals engine262 implements define them. A store to one
 *   on a sealed instance would add an own property, and fails; and a getter
 *   with no setter has nothing to store.
 * - `implementation`: a member ECMA-262 does not define, whose place an
 *   implementation chooses: `stack`, which V8 gives every error as an own
 *   writable property and engine262 and SpiderMonkey define as an accessor of
 *   `Error.prototype`. It is a member, read and called as the others are, and
 *   a store to it is not judged: it succeeds on one implementation and fails
 *   on another, and is left to the seal when it runs.
 * - `base`: the built-in whose prototype follows, or null where it is
 *   %Object.prototype%, whose members every object has (OBJECT_PROTOTYPE_MEMBERS).
 *
 * So a member is STORABLE on a sealed instance only where it is in `instance`,
 * and refused as a store only where it is in neither `instance` nor
 * `implementation`.
 * A program that stores to another declares it: `name = "E"` in the class body
 * is a field, an own property of every instance.
 *
 * `Array`, `String`, `Function` and the TypedArray constructors are not listed:
 * their instances are exotic objects with own properties that no name lists,
 * the elements and indices among them, and a store to one is left to the seal
 * when it runs. Neither is a host's constructor, `HTMLElement` and the like.
 * `library-members.test.mts` compares every row with the realm's intrinsics.
 */
export interface LibraryInstanceMembers {
  readonly base: string | null;
  readonly instance: readonly string[];
  readonly optional: readonly string[];
  readonly prototype: readonly string[];
  readonly implementation?: readonly string[];
}

const ERROR_PROTOTYPE = ['name', 'message', 'constructor'] as const;

export const LIBRARY_INSTANCE_MEMBERS: Readonly<Record<string, LibraryInstanceMembers>> = {
  Object: { base: null, instance: [], optional: [], prototype: [] },
  Error: { base: null, instance: [], optional: ['message', 'cause'], prototype: ['toString', 'message', 'name', 'stack', 'constructor'], implementation: ['stack'] },
  EvalError: { base: 'Error', instance: [], optional: ['message', 'cause'], prototype: ERROR_PROTOTYPE },
  RangeError: { base: 'Error', instance: [], optional: ['message', 'cause'], prototype: ERROR_PROTOTYPE },
  ReferenceError: { base: 'Error', instance: [], optional: ['message', 'cause'], prototype: ERROR_PROTOTYPE },
  SyntaxError: { base: 'Error', instance: [], optional: ['message', 'cause'], prototype: ERROR_PROTOTYPE },
  TypeError: { base: 'Error', instance: [], optional: ['message', 'cause'], prototype: ERROR_PROTOTYPE },
  URIError: { base: 'Error', instance: [], optional: ['message', 'cause'], prototype: ERROR_PROTOTYPE },
  AggregateError: { base: 'Error', instance: ['errors'], optional: ['message', 'cause'], prototype: ERROR_PROTOTYPE },
  Map: {
    base: null, instance: [], optional: [],
    prototype: ['clear', 'delete', 'entries', 'forEach', 'get', 'getOrInsert', 'getOrInsertComputed', 'has', 'keys', 'set', 'size', 'values', 'constructor'],
  },
  Set: {
    base: null, instance: [], optional: [],
    prototype: ['add', 'clear', 'delete', 'difference', 'entries', 'forEach', 'has', 'intersection', 'isDisjointFrom', 'isSubsetOf',
      'isSupersetOf', 'size', 'symmetricDifference', 'values', 'union', 'keys', 'constructor'],
  },
  WeakMap: { base: null, instance: [], optional: [], prototype: ['delete', 'get', 'getOrInsert', 'getOrInsertComputed', 'has', 'set', 'constructor'] },
  WeakSet: { base: null, instance: [], optional: [], prototype: ['add', 'delete', 'has', 'constructor'] },
  WeakRef: { base: null, instance: [], optional: [], prototype: ['deref', 'constructor'] },
  FinalizationRegistry: { base: null, instance: [], optional: [], prototype: ['register', 'unregister', 'constructor'] },
  Promise: { base: null, instance: [], optional: [], prototype: ['catch', 'finally', 'then', 'constructor'] },
  Date: {
    base: null, instance: [], optional: [],
    prototype: ['getDate', 'getDay', 'getFullYear', 'getHours', 'getMilliseconds', 'getMinutes', 'getMonth', 'getSeconds', 'getTime',
      'getTimezoneOffset', 'getUTCDate', 'getUTCDay', 'getUTCFullYear', 'getUTCHours', 'getUTCMilliseconds', 'getUTCMinutes',
      'getUTCMonth', 'getUTCSeconds', 'setDate', 'setFullYear', 'setHours', 'setMilliseconds', 'setMinutes', 'setMonth', 'setSeconds',
      'setTime', 'setUTCDate', 'setUTCFullYear', 'setUTCHours', 'setUTCMilliseconds', 'setUTCMinutes', 'setUTCMonth', 'setUTCSeconds',
      'toDateString', 'toISOString', 'toJSON', 'toLocaleDateString', 'toLocaleString', 'toLocaleTimeString', 'toString', 'toTimeString',
      'toUTCString', 'valueOf', 'constructor'],
  },
  RegExp: {
    base: null, instance: ['lastIndex'], optional: [],
    prototype: ['exec', 'dotAll', 'flags', 'global', 'hasIndices', 'ignoreCase', 'multiline', 'source', 'sticky', 'test', 'toString',
      'unicode', 'unicodeSets', 'constructor'],
  },
  ArrayBuffer: {
    base: null, instance: [], optional: [],
    prototype: ['byteLength', 'detached', 'maxByteLength', 'resizable', 'resize', 'slice', 'transfer', 'transferToFixedLength', 'constructor'],
  },
  DataView: {
    base: null, instance: [], optional: [],
    prototype: ['buffer', 'byteLength', 'byteOffset', 'getBigInt64', 'getBigUint64', 'getFloat16', 'getFloat32', 'getFloat64', 'getInt8',
      'getInt16', 'getInt32', 'getUint8', 'getUint16', 'getUint32', 'setBigInt64', 'setBigUint64', 'setFloat16', 'setFloat32', 'setFloat64',
      'setInt8', 'setInt16', 'setInt32', 'setUint8', 'setUint16', 'setUint32', 'constructor'],
  },
  Boolean: { base: null, instance: [], optional: [], prototype: ['toString', 'valueOf', 'constructor'] },
  Number: { base: null, instance: [], optional: [], prototype: ['toExponential', 'toFixed', 'toLocaleString', 'toPrecision', 'toString', 'valueOf', 'constructor'] },
};

/**
 * The members the built-in _name_ gives an instance of a class over it, and
 * those a store to which succeeds on a sealed one; undefined where the table
 * does not list _name_.
 */
export function LibraryInstanceMembersOf(name: string): {
  members: ReadonlySet<string>, own: ReadonlySet<string>, storable: ReadonlySet<string>, unjudged: ReadonlySet<string>,
} | undefined {
  const members = new Set<string>();
  const own = new Set<string>();
  const storable = new Set<string>();
  const unjudged = new Set<string>();
  for (let at: string | null = name; at !== null;) {
    const row: LibraryInstanceMembers | undefined = Object.hasOwn(LIBRARY_INSTANCE_MEMBERS, at) ? LIBRARY_INSTANCE_MEMBERS[at] : undefined;
    if (!row) return undefined;
    for (const key of [...row.instance, ...row.optional, ...row.prototype]) members.add(key);
    for (const key of [...row.instance, ...row.optional]) own.add(key);
    for (const key of row.instance) storable.add(key);
    // A member an implementation may give an instance as its own may hide a
    // member of that name, and a store to it may succeed.
    for (const key of row.implementation ?? []) {
      own.add(key);
      unjudged.add(key);
    }
    at = row.base;
  }
  return { members, own, storable, unjudged };
}
