import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';
import { binaryPacketProgram } from './fixtures/binarypacket-harness.mts';

// Fixture: examples/binarypacket.md of the ecmascript-types repository.
//
// The binary packet example - its writer, reader, and tuple reader, with `doc` decorators, typed inputs,
// and in place of the network the writer's bytes - reproduces every value it wrote. The floats are
// quantized to 18 bits over [-1024, 1024], a step of about 0.0078.
test('the binary packet example round-trips every written value', () => {
  expect(evaluated(binaryPacketProgram)).toBe('513,true,12.5001220703125,-300.2523193359375,777777,ace | true,3000,zed');
}, 180000);
