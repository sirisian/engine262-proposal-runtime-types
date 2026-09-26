import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

// Phase 4's exit test (C24): the design's binary packet example
// (ecmascript-types, examples/binarypacket.md) - its writer, reader, and tuple
// reader, with the design's `doc` decorators, typed inputs, and in place of the
// network the writer's bytes - reproduces every value it wrote. The floats are
// quantized to 18 bits over [-1024, 1024], a step of about 0.0078.
test('the binary packet example round-trips every written value (C24)', () => {
  const program = readFileSync(new URL('./fixtures/binarypacket-harness.js', import.meta.url), 'utf8');
  expect(evaluated(program)).toBe('513,true,12.5001220703125,-300.2523193359375,777777,ace | true,3000,zed');
});
