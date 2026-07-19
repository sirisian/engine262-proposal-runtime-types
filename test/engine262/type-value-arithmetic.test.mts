import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// R3 regression floor: per-type arithmetic and wraparound. Every assertion here
// would FAIL against pre-R3 code, where arithmetic on typed numbers decayed to
// plain `number` with no wraparound. See the remediation plan; this closes the
// arithmetic half of Finding 1 (R1 closed identity).

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

test('arithmetic preserves the numeric value type', () => {
  expect(evaluated('Reflect.typeOf((5 := uint8) + (3 := uint8)) === uint8 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('(5 := uint8) + (3 := uint8) === (8 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('(6 := uint8) * (7 := uint8) === (42 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('(10 := uint8) - (3 := uint8) === (7 := uint8) ? "ok" : "no";')).toBe('ok');
});

test('unsigned integer arithmetic wraps modulo 2**N', () => {
  expect(evaluated('(200 := uint8) + (100 := uint8) === (44 := uint8) ? "ok" : "no";')).toBe('ok');   // 300 mod 256
  expect(evaluated('(16 := uint8) * (16 := uint8) === (0 := uint8) ? "ok" : "no";')).toBe('ok');       // 256 mod 256
  expect(evaluated('(0 := uint8) - (1 := uint8) === (255 := uint8) ? "ok" : "no";')).toBe('ok');       // underflow
  expect(evaluated('(65535 := uint16) + (1 := uint16) === (0 := uint16) ? "ok" : "no";')).toBe('ok');  // uint16 wrap
});

test('signed integer arithmetic wraps in two\'s complement', () => {
  expect(evaluated('(100 := int8) + (100 := int8) === (-56 := int8) ? "ok" : "no";')).toBe('ok');      // 200 -> -56
  expect(evaluated('(-100 := int8) - (100 := int8) === (56 := int8) ? "ok" : "no";')).toBe('ok');      // -200 -> 56
  expect(evaluated('(127 := int8) + (1 := int8) === (-128 := int8) ? "ok" : "no";')).toBe('ok');       // overflow to min
});

test('unary minus and bitwise NOT preserve and wrap', () => {
  expect(evaluated('-(5 := int8) === (-5 := int8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('-(-128 := int8) === (-128 := int8) ? "ok" : "no";')).toBe('ok');   // -(-128) wraps to -128
  expect(evaluated('~(0 := uint8) === (255 := uint8) ? "ok" : "no";')).toBe('ok');     // ~0 = -1 -> 255
});

test('increment and decrement preserve and wrap', () => {
  expect(evaluated('let x = (5 := uint8); x++; x === (6 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('let x = (255 := uint8); x++; x === (0 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('let x = (0 := uint8); x--; x === (255 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('let x = (5 := uint8); ++x === (6 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('let x = (5 := uint8); let y = x++; y === (5 := uint8) && x === (6 := uint8) ? "ok" : "no";')).toBe('ok');
});

test('typed and plain operands combine, yielding a typed result', () => {
  expect(evaluated('(5 := uint8) + 3 === (8 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('Reflect.typeOf(3 + (5 := uint8)) === uint8 ? "ok" : "no";')).toBe('ok');
});

test('explicit Number() unwraps a typed number to a plain Number', () => {
  expect(evaluated('Number(5 := uint8) === 5 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('Reflect.typeOf(Number(5 := uint8)) === (type number) ? "ok" : "no";')).toBe('ok');
});

test('R1 identity is unaffected by arithmetic changes', () => {
  expect(evaluated('(5 := uint8) === 5 ? "eq" : "neq";')).toBe('neq');
  expect(evaluated('(5 := uint8) is uint8 ? "yes" : "no";')).toBe('yes');
});
