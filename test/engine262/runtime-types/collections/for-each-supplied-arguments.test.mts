import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

// #sec-keyed-collections, #sec-isfunctionsubtype
const collections = [
  { name: 'Map', source: 'const c = new Map.<string, uint8>();', types: ['uint8', 'string', 'Map.<string, uint8>'] },
  { name: 'Set', source: 'const c = new Set.<uint8>();', types: ['uint8', 'uint8', 'Set.<uint8>'] },
];

for (const { name, source, types } of collections) {
  test(`${name}.forEach supplies value, key and collection`, () => {
    for (let count = 0; count <= types.length; count += 1) {
      const parameters = types.slice(0, count).map((type, i) => `a${i}: ${type}`).join(', ');
      expect(ok(`${source} c.forEach((${parameters}) => {});`)).toBe(true);
    }
    expect(ok(`${source} c.forEach((value, key, collection) => {});`)).toBe(true);
  });

  test(`${name}.forEach checks each supplied argument and the required arity`, () => {
    for (let bad = 0; bad <= types.length; bad += 1) {
      const parameters = types.map((type, i) => `a${i}: ${i === bad ? 'boolean' : type}`);
      if (bad === types.length) parameters.push('extra: boolean');
      expectStaticTypeError(`${source} c.forEach((${parameters.join(', ')}) => {});`);
    }
  });
}

test('Map.forEach passes the typed value first and preserves thisArg', () => {
  expect(evaluated('const m = new Map.<string,uint8>(); m.set("a", 7); const context = {}; let out = "";'
    + ' m.forEach(function(v:uint8, k:string, c:Map.<string,uint8>) {'
    + ' out = k + ":" + String(v) + ":" + String(c === m) + ":" + String(this === context); }, context); out;')).toBe('a:7:true:true');
});

test('Set.forEach supplies the element twice and the original receiver', () => {
  expect(evaluated('const s = new Set.<uint8>(); s.add(7); let out = "";'
    + ' s.forEach((v:uint8, k:uint8, c:Set.<uint8>) => { out = String(v === k) + ":" + String(c === s); }); out;')).toBe('true:true');
});
