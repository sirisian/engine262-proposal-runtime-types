import { test } from 'vitest';
import { runChallenge, expectBuilderTrue } from './harness.mts';

// Type Challenge - Warm-up - 13 - Hello World
// Source: ecmascript-types/examples/typechallenges.md
// "Make HelloWorld a string rather than any."
//
// TypeScript (issue #150):   type HelloWorld = string
//
// Builder:
//   type HelloWorld = string;
//   HelloWorld === string;              // the case, as an assertion
//   Reflect.typeOf('hi') === HelloWorld;
//
// The warm-up asks for a type, not a computation; the builder is identical to
// the TypeScript, and the only difference is that its assertions can run.

test('warm-up 13 - Hello World', () => {
  runChallenge(
    'type HelloWorld = string;',
    [
      'HelloWorld === string',            // type identity via interning
      "Reflect.typeOf('hi') === HelloWorld", // membership: a string's type is HelloWorld
    ],
  );
});

// The same, checked as one self-contained program ending in a boolean, to
// exercise expectBuilderTrue and confirm the multi-assertion program runs whole.
test('warm-up 13 - Hello World (whole program)', () => {
  expectBuilderTrue(`
    type HelloWorld = string;
    const a = HelloWorld === string;
    const b = Reflect.typeOf('hi') === HelloWorld;
    String(a && b);
  `);
});
