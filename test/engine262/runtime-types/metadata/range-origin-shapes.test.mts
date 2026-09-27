import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const ranges = ['0..<10', '0..=10', '0<..<10', '0<..=10', '0..', '0<..', '..<10', '..=10', '..'];

// Compare the SAME value under the SAME field type at every origin. Comparing
// a written 0..<10 with a default .. changes the range shape as well as origin.
// Supply all generic arguments so these regressions do not enshrine the
// interpreter's current acceptance of bare library generic names/defaults.
const shapes = [
  'Range.<float64, Range.Bound.Closed, Range.Bound.Open>',
  'RangeBounds.<float64>',
];

function declaration(shape: string, defaultValue: string): string {
  return `type Bounds = { bounds?: ${shape} };
    meta Bounds {
      default = ${defaultValue};
      subtype(sub, sup) {
        return sup.bounds === undefined
          || (sub.bounds !== undefined && sup.bounds.contains(sub.bounds));
      }
      validate(value, constraint) {
        return constraint.bounds === undefined || constraint.bounds.contains(Number(value));
      }
    }`;
}

const origins = {
  default: (shape: string, range: string) => `${declaration(shape, `{ bounds: ${range} }`)}
    String((5 := float64) is float64);`,
  written: (shape: string, range: string) => `${declaration(shape, '{}')}
    type T = float64.<{ bounds: ${range} }>;
    String((5 := T) is T);`,
  builder: (shape: string, range: string) => `${declaration(shape, '{}')}
    function build() { return { bounds: ${range} }; }
    type T = float64.<build()>;
    String((5 := T) is T);`,
  reflection: (shape: string, range: string) => `${declaration(shape, '{}')}
    const T = Reflect.makeType({ kind: 'parameterized', base: float64, metadata: { bounds: ${range} } });
    String(T(5) is T);`,
};

for (const shape of shapes) {
  for (const [origin, source] of Object.entries(origins)) {
    test.each(ranges)(`${origin} range %s respects ${shape}`, (range) => {
      const script = source(shape, range);
      if (shape === 'RangeBounds.<float64>' || range === '0..<10') {
        expect(evaluated(script)).toBe('true');
      } else {
        // Defaults and supplied portions have different diagnostics, but both
        // must identify the constraint shape rather than fail incidentally.
        expectThrown(script, 'shape');
      }
    });
  }
}

test.each(ranges)('range origins and reflection intern the same metadata for %s', (range) => {
  expect(evaluated(`${declaration('RangeBounds.<float64>', `{ bounds: ${range} }`)}
    type Written = float64.<{ bounds: ${range} }>;
    function build() { return { bounds: ${range} }; }
    type Built = float64.<build()>;
    const Reflected = Reflect.makeType({ kind: 'parameterized', base: float64, metadata: { bounds: ${range} } });
    String(Written === Built) + '/' + String(Written === Reflected)
      + '/' + String(Reflect.makeType(Reflect.getReflection(Written)) === Written)
      + '/' + String((5 := float64) is Written);`)).toBe('true/true/true/true');
});

test('a full range default does not bypass a two-ended field constraint', () => {
  // This declaration alone must fail; no parameterization is needed to find it.
  expectThrown(declaration(shapes[0], '{ bounds: .. }'), 'constraint shape');
});
