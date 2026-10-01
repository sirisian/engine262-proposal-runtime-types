import { expect, test } from 'vitest';
import { run } from '../harness.mts';
import {
  Agent, ManagedRealm, setSurroundingAgent, DeserializeTypeTable, SerializeTypeTable, TYPE_TABLE_VERSION, EnsureCompletion,
} from '#self';

function typeOf(source: string) {
  const result = EnsureCompletion(run(source));
  expect(result.Type).toBe('normal');
  return result.Value as object;
}

function readFresh(table: ReturnType<typeof SerializeTypeTable>) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const pop = realm.pushTopContext();
  try {
    return { realm, types: DeserializeTypeTable(table) };
  } finally {
    pop?.();
  }
}

// #sec-expansion-artifact: a JSON boundary preserves defaults and type identity.
test.each([
  'uint8 = 7',
  'int64 = -7',
  'uint64 = 18446744073709551615n',
  'float32 = 7',
  'float32 = 7.5',
  'float64 = -0',
  'float64 = NaN',
  'float64 = Infinity',
  'float64 = -Infinity',
  'number = -0',
  'number = NaN',
  'number = Infinity',
  'bigint = 9007199254740993n',
])('a numeric default retains its value and type: %s', (element) => {
  const source = `type T = [${element}]; T;`;
  const original = typeOf(source);
  const wire = JSON.parse(JSON.stringify(SerializeTypeTable(new Map([['T', original]]))));
  expect(DeserializeTypeTable(wire)?.get('T')).toBe(original);
  const consumer = readFresh(wire);
  const evaluated = EnsureCompletion(consumer.realm.evaluateScriptSkipDebugger(source));
  expect(evaluated.Type).toBe('normal');
  expect(consumer.types?.get('T')).not.toBe(original);
  expect(consumer.types?.get('T')).toBe(evaluated.Value);
});

test('pattern metadata resolves Type Object values in the consumer agent', () => {
  const source = 'type P = string.<{ pattern: /^a$/i }>; P;';
  const original = typeOf(source) as { TypeRecord: { MetaType: object } };
  const wire = JSON.parse(JSON.stringify(SerializeTypeTable(new Map([['P', original]]))));
  const consumer = readFresh(wire);
  const read = consumer.types?.get('P') as typeof original;
  const owner = EnsureCompletion(consumer.realm.evaluateScriptSkipDebugger('type { pattern: any };'));
  expect(owner.Type).toBe('normal');
  expect(read.TypeRecord.MetaType).toBe(owner.Value);
  expect(read.TypeRecord.MetaType).not.toBe(original.TypeRecord.MetaType);
  expect(read).toBe(EnsureCompletion(consumer.realm.evaluateScriptSkipDebugger(source)).Value);
});

test('a Type Object default remains a value of type type', () => {
  const source = 'type T = [type = uint8]; T;';
  const original = typeOf(source);
  const wire = JSON.parse(JSON.stringify(SerializeTypeTable(new Map([['T', original]]))));
  const consumer = readFresh(wire);
  const evaluated = EnsureCompletion(consumer.realm.evaluateScriptSkipDebugger(source));
  expect(evaluated.Type).toBe('normal');
  expect(consumer.types?.get('T')).toBe(evaluated.Value);
});

test('a table using the ambiguous numeric encoding is declined', () => {
  const original = typeOf('type T = [uint8 = 7]; T;');
  const table = SerializeTypeTable(new Map([['T', original]]));
  expect(table.version).toBe(TYPE_TABLE_VERSION);
  expect(DeserializeTypeTable({ ...table, version: 1 })).toBeUndefined();
});

test('a cycle through Type Object values falls back to evaluation', () => {
  expect(DeserializeTypeTable({
    version: TYPE_TABLE_VERSION,
    types: [{ Kind: 'tuple', Elements: [{ Type: { $ref: 0 }, Initial: { $type: 0 }, Rest: false }] }],
    exports: { T: 0 },
  })).toBeUndefined();
});
