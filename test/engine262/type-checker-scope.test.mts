import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

function runScript(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function compileModule(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.compileModule(source, { specifier: 'm' });
}

function expectOk(source: string) {
  expect(runScript(source)).toMatchObject({ Type: 'normal' });
}

function expectTypeError(source: string) {
  expect(runScript(source)).toMatchObject({ Type: 'throw' });
}

test('block scopes shadow without leaking', () => {
  // Inner block re-annotates x; the outer binding is unaffected after.
  expectOk('let x: uint8 = 5; { let x: string = "s"; x = "t"; } x = 6;');
  // The inner error is still caught.
  expectTypeError('let x: uint8 = 5; { let y: string = "s"; y = 3; }');
  // A binding from an inner block does not exist outside it: no false type.
  expectOk('{ let z: uint8 = 1; } let z = "anything";');
});

test('call-site arguments are checked against function types', () => {
  expectTypeError('let f: (a: uint8) => void = () => {}; f("s");');
  expectOk('let f: (a: uint8) => void = () => {}; f(5);');
  expectTypeError('let g: (a: string, b: uint8) => void = () => {}; g("ok", "no");');
});

test('member access types flow from object types', () => {
  expectTypeError('let p: { n: uint8 } = { n: (1 := uint8) }; let s: string = p.n;');
  expectOk('let p: { n: uint8 } = { n: (1 := uint8) }; let m: uint8 = p.n;');
});

test('module goal is checked too', () => {
  // A type error in a module makes compilation throw; a well-typed one is normal.
  expect(compileModule('let x: uint8 = "s";')).toMatchObject({ Type: 'throw' });
  expect(compileModule('let x: uint8 = 5;')).toMatchObject({ Type: 'normal' });
});

test('unmodelled remains any: silence', () => {
  expectOk('let f = (x) => x; let n: uint8 = f(5); let s: string = f("s");');
});
