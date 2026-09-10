import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, TypeOrigins,
} from '#self';

/**
 * #sec-provenance's `source` - "the host's name for the source, where it supplied
 * one" - was never delivered. It was read off `node.scriptOrModule.HostDefined`,
 * and NOTHING in this engine sets a `scriptOrModule` property on a parse node, so
 * every origin ever recorded carried `source: undefined` and the field existed in
 * name only.
 *
 * The host's name comes from the ACTIVE script or module instead: which module is
 * being evaluated when a declaration is evaluated is what answers "where was this
 * written".
 *
 * This is what an expansion artifact needs to name a ~nominal~ type. A nominal
 * cannot be carried by value - its record holds a declaration and a constructor,
 * neither of which crosses a boundary - so it travels as its module specifier and
 * its declared name, and until now the specifier half was always missing.
 */

function evaluateModule(specifier: string, source: string): Promise<unknown> {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const parsed = realm.compileModule(source, { specifier } as never) as unknown as { Value?: never };
  if (!parsed?.Value) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    (realm as unknown as {
      evaluateModule(m: unknown, x: unknown, cb: (c: unknown) => void): void,
    }).evaluateModule(parsed.Value, undefined, () => {
      const global = (realm as unknown as {
        GlobalObject: { properties: Map<unknown, { Value?: unknown }> },
      }).GlobalObject;
      resolve(global.properties.get('__T' as never)?.Value);
    });
  });
}

test('a class declared in a module carries that module as its source', async () => {
  const type = await evaluateModule('pkg/user.mts',
    'export class User { name: string; }\nglobalThis.__T = User;\n');
  const [origin] = TypeOrigins(type as never);
  expect(origin?.source).toBe('pkg/user.mts');
  expect(origin?.name).toBe('User');
});

test('two modules give two sources for the same declared name', async () => {
  // The collision an artifact would otherwise have: a nominal is named by module
  // AND declared name, and the module half is what tells these apart.
  //
  // Read immediately after each evaluation. The origins table is keyed per AGENT,
  // so a second agent cannot answer for a type recorded under the first - which
  // is correct, and is the shape a producer must respect: an artifact is written
  // for one graph in one agent, not assembled from several.
  const first = await evaluateModule('pkg/a.mts', 'class T { x: uint8; }\nglobalThis.__T = T;\n');
  const fromA = TypeOrigins(first as never)[0]?.source;
  const second = await evaluateModule('pkg/b.mts', 'class T { y: string; }\nglobalThis.__T = T;\n');
  const fromB = TypeOrigins(second as never)[0]?.source;
  expect(fromA).toBe('pkg/a.mts');
  expect(fromB).toBe('pkg/b.mts');
});

test('an alias and an enum carry a source too, not only a class', async () => {
  const alias = await evaluateModule('pkg/alias.mts',
    'type A = { a: uint8 };\nglobalThis.__T = A;\n');
  expect(TypeOrigins(alias as never)[0]?.source).toBe('pkg/alias.mts');
  const enumeration = await evaluateModule('pkg/enum.mts',
    'enum E { a, b }\nglobalThis.__T = E;\n');
  expect(TypeOrigins(enumeration as never)[0]?.source).toBe('pkg/enum.mts');
});
