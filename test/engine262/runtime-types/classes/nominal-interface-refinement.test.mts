import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';

// #sec-issubtype and #sec-interfaces-semantics: declaration verification and
// nominal refinement are distinct from structural membership of a value.
const corpus = JSON.parse(readFileSync(new URL('../conformance/nominal-interface-refinement.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source: string; value?: string; error?: string }[];
};

for (const { name, source, value, error } of corpus.cases) {
  test(name, () => {
    const result = observeScript(source);
    expect(result.completion.Type, (result.completion.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString).toBe(error ? 'throw' : 'normal');
    expect(result.errorClass).toBe(error);
    expect(result.bodyEntered).toBe(!error);
    if (error) {
      expect(result.diagnostic?.phase).toBe('static');
    } else {
      expect((result.completion.Value as { stringValue?: () => string }).stringValue?.()).toBe(value);
      expect(result.diagnostic).toBeUndefined();
    }
  });
}

const declaration = 'export interface Has<T:type>{get():T;}export class E implements Has.<E>{get():E{return this;}}';

test('Module imports preserve a recursive declared refinement', async () => {
  const result = await observeModuleGraph({ dep: declaration,
    main: 'import {Has,E} from "dep";if(!Reflect.isAssignable(E,Has.<E>))throw new Error("refinement");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.errorClass).toBeUndefined();
});

test('Module re-exports preserve inherited implementation arguments', async () => {
  const result = await observeModuleGraph({ dep: declaration, bridge: 'export {Has,E} from "dep";',
    main: 'import {Has,E} from "bridge";class D extends E{}if(!Reflect.isAssignable(D,Has.<E>)||Reflect.isAssignable(D,Has.<D>))throw new Error("arguments");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'bridge', 'main'] });
  expect(result.errorClass).toBeUndefined();
});

test('Module local dependent bounds select the declared implementation', async () => {
  const result = await observeModuleGraph({ dep: 'export const marker=1;',
    main: 'import {marker} from "dep";' + declaration + 'function choose<T:type>():string{return "base";}function choose<const V extends Has.<V>>():string{return "case";}if(choose.<E>()!=="case")throw new Error("selection");',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.errorClass).toBeUndefined();
});

test('Module local invalid implementation fails before any body executes', async () => {
  const result = await observeModuleGraph({ dep: 'export const marker=1;',
    main: 'import {marker} from "dep";interface Has<T:type>{get():T;}class Bad implements Has.<Bad>{get():string{return "bad";}}',
  });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError', diagnostic: { phase: 'static' } });
});
