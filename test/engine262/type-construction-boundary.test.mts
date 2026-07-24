import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// F33: the construction boundary, observable at last. A bare value reaches a
// parameterization through the cast (`:=`) or the Type Object call, both of
// which run the validation judgment; a `validate` that refuses keeps the value
// out, and a meta type that constrains and defines no `validate` admits no
// bare value at all, which is what makes a brand a brand. Between two
// parameterizations the crossing is ConvertParameterization: `subtype` gates
// each meta type independently, `conversionFactor` scales, and the result
// carries the target so a chain still has provenance. The crossing is
// consulted BEFORE the value-level membership shortcut, because `is` is
// deliberately provenance-blind while the crossing is exactly the provenance
// question. The annotation (checked) boundary admits no bare value into a
// parameterization — the cast is the way in, per the specification's "a type
// error until operator blocks give `number` a way in".

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

const units = `
  type Dim = { m: number, s: number, ratio: number };
  meta Dim {
    default = { m: 0, s: 0, ratio: 1 };
    subtype(a, b) { return a.m === b.m && a.s === b.s; }
    validate(v, c) { return true; }
    conversionFactor(a, b) { return a.ratio / b.ratio; }
  }
  type Meter = float32.<{ m: 1, ratio: 1 }>;
  type Kilometer = float32.<{ m: 1, ratio: 1000 }>;
  type Velocity = float32.<{ m: 1, s: -1, ratio: 1 }>;
`;

const bounds = `
  type B = { min: number };
  meta B {
    default = { min: -Infinity };
    subtype(a, b) { return b.min <= a.min; }
    validate(v, c) { return v >= c.min; }
  }
  type NonNeg = float64.<{ min: 0 }>;
`;

test('a cast constructs into a parameterization, and the result satisfies its own type', () => {
  expect(evaluated(`${units} const km = (2 := Kilometer); String(km is Kilometer);`)).toBe('true');
  expect(evaluated(`${bounds} String(((5 := NonNeg)) is NonNeg);`)).toBe('true');
});

test('a validate that refuses keeps the value out at the cast', () => {
  // F33's headline, closed: the bound is enforced where the bare value tries
  // to come in.
  expectThrown(`${bounds} (-1 := NonNeg); "admitted";`);
});

test('a meta type with no validate admits no bare value: the brand', () => {
  expectThrown(`
    type T = { tag: string };
    meta T { default = { tag: "" }; subtype(a, b) { return a.tag === b.tag; } }
    (1 := float32.<{ tag: "A" }>); "admitted";
  `);
});

test('the Type Object call is the same boundary: admits with validate, refuses without it', () => {
  expect(evaluated(`${bounds} String((type NonNeg)(5) is NonNeg);`)).toBe('true');
  expectThrown(`${bounds} (type NonNeg)(-1); "admitted";`);
});

test('the crossing scales by the conversion factor', () => {
  // Two kilometres are two thousand metres: `subtype` admits (the exponents
  // agree), and the ratio's factor does the arithmetic. This is the line F33
  // said was implemented and unobservable.
  expect(evaluated(`${units} String(((2 := Kilometer) := Meter));`)).toBe('2000');
});

test('the crossing is gated by subtype even where validate would admit the raw value', () => {
  // Kilometer to Velocity: `validate` is vacuously true here, but the crossing
  // asks `subtype`, and differing exponents refuse. Provenance is consulted
  // before the value-level membership shortcut, or this admits.
  expectThrown(`${units} ((2 := Kilometer) := Velocity); "admitted";`);
});

test('the crossing result carries the target, so a chain keeps its provenance', () => {
  // Kilometre to metre and back: the intermediate value must still KNOW it is
  // metres, or the return trip has no `from` to gate and scale on.
  expect(evaluated(`${units} String((((2 := Kilometer) := Meter)) := Kilometer);`)).toBe('2');
});

test('the checked boundary crosses too: an annotation scales a carried parameterization', () => {
  // The checked rule differs from the cast only in what a LOSSY numeric
  // conversion does; a crossing is a conversion, not a loss.
  expect(evaluated(`${units} const km = (2 := Kilometer); let m: Meter = km; String(m);`)).toBe('2000');
});

test('the checked boundary admits no bare value into a parameterization: the cast is the way in', () => {
  expectThrown(`${bounds} let x: NonNeg = 5; "admitted";`);
  expect(evaluated(`${bounds} let x: NonNeg = (5 := NonNeg); String(x is NonNeg);`)).toBe('true');
});

test('a BigInt is a conversion source for the float families', () => {
  // The lossy cast rounds to the width; the checked boundary admits exactly
  // where the width represents the value exactly, and RangeErrors where it
  // rounds. An integer target stays refused: exactness at the wide widths is
  // the pinned prerequisite.
  expect(evaluated('String((3n := float64));')).toBe('3');
  expect(evaluated('String(float64(3n));')).toBe('3');
  expect(evaluated('let f: float64 = 3n; String(f);')).toBe('3');
  expectThrown('let f: float64 = (2n ** 70n) + 1n; "admitted";');
  expectThrown('(3n := uint8); "admitted";');
});
