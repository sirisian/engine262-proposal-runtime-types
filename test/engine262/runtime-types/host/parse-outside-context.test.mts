import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, ParseModule, ParseScript, setSurroundingAgent,
} from '#self';

/**
 * Parsing must not require a running execution context.
 *
 * A parse error is reported as a SyntaxError OBJECT, and constructing one reads
 * %SyntaxError% from the running execution context's realm. A host that
 * compiles source before entering the realm - which an embedding does - hit an
 * undefined context and crashed the host on any malformed input, rather than
 * receiving the list of errors ParseScript promises to return. ParseScript and
 * ParseModule run on the realm they were handed when nothing else is running.
 */

test('ParseScript reports a syntax error with no context on the stack', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  expect(agent.executionContextStack.length).toBe(0);

  const errors = ParseScript('const c = new GridArray<10, 10>();', realm, {});
  expect(Array.isArray(errors)).toBe(true);
  expect((errors as unknown[]).length).toBeGreaterThan(0);
  // the stack is left as it was found
  expect(agent.executionContextStack.length).toBe(0);
});

test('ParseModule does the same', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  expect(agent.executionContextStack.length).toBe(0);

  const errors = ParseModule('const = ;', realm, {});
  expect(Array.isArray(errors)).toBe(true);
  expect(agent.executionContextStack.length).toBe(0);
});

test('valid source still parses with no context on the stack', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();

  const script = ParseScript('class G<W: uint32> extends [W].<uint8> { }', realm, {});
  expect(Array.isArray(script)).toBe(false);
  expect(agent.executionContextStack.length).toBe(0);
});
