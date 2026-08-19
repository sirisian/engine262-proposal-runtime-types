import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-union-boundary-selection, #sec-requiretype, #sec-canonicalizetype.
 *
 * Where a value of an unknown type reaches a union-typed boundary, some member
 * of the union receives it. The implementation took the first member that
 * accepted, in the order the members were WRITTEN, which a canonical union
 * cannot express: CanonicalizeType orders members and Type Objects are interned
 * on the canonical record, so `uint8 | uint32` and `uint32 | uint8` are the
 * SAME type - the same interned Type Object - and a boundary may meet that type
 * as a Type Object with no source spelling at all.
 *
 * The observable cost was worse than the inconsistency. At `string | uint32` a
 * Number crossed into `string` and the boundary stored the text `"42"`: silent
 * textification of a number, which is the failure the string rule's refuse-list
 * exists to prevent, reachable through nothing but the order two members were
 * written in.
 *
 * The rungs are: a member the value is already of; a numeric member that
 * represents it exactly, narrowest first and integers before floats for an
 * integer-valued source; then any remaining member, which is where the
 * canonical-text rung and every non-numeric conversion land.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

/** The completion value of _source_, as a string. */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

/** The member `g()`'s result crosses into at a binding of _annotation_. */
function picked(annotation: string, returned: string): string {
  return value(`function g() { return ${returned}; }
    const u: ${annotation} = g();
    const name = Reflect.typeOf(u) === uint8 ? 'uint8'
      : Reflect.typeOf(u) === uint16 ? 'uint16'
      : Reflect.typeOf(u) === uint32 ? 'uint32'
      : Reflect.typeOf(u) === int8 ? 'int8'
      : Reflect.typeOf(u) === float32 ? 'float32'
      : Reflect.typeOf(u) === float64 ? 'float64'
      : Reflect.typeOf(u) === string ? 'string'
      : typeof u;
    name;`);
}

test('selection does not depend on the order members are written', () => {
  // The same canonical type, spelled both ways, must select the same member.
  expect(picked('uint8 | uint32', '5')).toBe('uint8');
  expect(picked('uint32 | uint8', '5')).toBe('uint8');
  expect(picked('uint16 | uint8 | uint32', '5')).toBe('uint8');
});

test('a number does not become text where a numeric member represents it', () => {
  // Both spellings pick the numeric member; before, `string | uint32` stored
  // the string "42".
  expect(picked('uint32 | string', '42')).toBe('uint32');
  expect(picked('string | uint32', '42')).toBe('uint32');
});

test('the canonical-text rung still receives what no numeric member represents', () => {
  // 300 is not a `uint8`, so the string member takes it - the string rule's
  // conversion is unchanged, it is only no longer reached ahead of a numeric
  // member that could have held the value exactly.
  expect(picked('uint8 | string', '300')).toBe('string');
  expect(picked('string | uint8', '300')).toBe('string');
});

test('the narrowest representing member wins', () => {
  expect(picked('uint16 | uint8', '300')).toBe('uint16');
  expect(picked('uint8 | uint16', '300')).toBe('uint16');
  expect(picked('uint8 | uint16 | uint32', '70000')).toBe('uint32');
});

test('an integer-valued source prefers an integer member', () => {
  expect(picked('float32 | uint8', '5')).toBe('uint8');
  expect(picked('uint8 | float32', '5')).toBe('uint8');
  // A value no integer member represents exactly takes the float.
  expect(picked('float32 | uint8', '2.5')).toBe('float32');
});

test('a negative value takes the signed member', () => {
  expect(picked('uint8 | int8', '-5')).toBe('int8');
  expect(picked('int8 | uint8', '-5')).toBe('int8');
});

test('a value already of a member crosses unchanged', () => {
  // The identity rung: no conversion is attempted at all, so a `uint32` that
  // would also fit `uint8` keeps the type it arrived with, and the value's own
  // type wins over the narrowest-representing rule.
  expect(value(`function typed(): uint32 { return 5; }
    function g() { return typed(); }
    const u: uint8 | uint32 = g();
    Reflect.typeOf(u) === uint32 ? 'uint32' : 'converted';`)).toBe('uint32');
});

test('non-numeric unions are unaffected', () => {
  expect(picked('string | boolean', '"a"')).toBe('string');
  expect(value('function g() { return undefined; } const u: uint32 | undefined = g(); `${u}`;')).toBe('undefined');
  expect(value('function g() { return null; } const u: uint32 | null = g(); `${u}`;')).toBe('null');
});

test('a value no member admits is still refused', () => {
  expect(run('function g() { return {}; } const u: uint8 | uint16 = g();')).toMatchObject({ Type: 'throw' });
});
