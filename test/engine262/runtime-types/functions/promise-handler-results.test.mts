import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, settledAfterJobs } from '../harness.mts';

// A chained handler observes a fulfilled value, not the returned Promise.
for (const method of ['then', 'catch']) {
  test(`${method} unwraps a declared Promise result`, () => {
    expectStaticTypeError(`function unused(p:Promise.<uint8,string>,q:Promise.<uint8,string>){p.${method}(()=>q).then(v=>{const wrong:string=v;});}`);
    expect(ok(`function unused(p:Promise.<uint8,string>,q:Promise.<uint8,string>){p.${method}(()=>q).then(v=>{const value:uint8=v;});}`)).toBe(true);
  });

  test(`${method} joins fulfilled alternatives`, () => {
    expectStaticTypeError(`function unused(p:Promise.<uint8,string>,q:Promise.<uint8,string>|Promise.<string,string>){p.${method}(()=>q).then(v=>{const wrong:boolean=v;});}`);
    expect(ok(`function unused(p:Promise.<uint8,string>,q:Promise.<uint8,string>|Promise.<string,string>){p.${method}(()=>q).then(v=>{const value:uint8|string=v;});}`)).toBe(true);
  });

  test(`${method} recursively unwraps established Promise arguments`, () => {
    expect(ok(`function unused(p:Promise.<uint8,string>,q:Promise.<Promise.<uint8,string>,string>){p.${method}(()=>q).then(v=>{const value:uint8=v;});}`)).toBe(true);
  });
}

test('then retains scalar handler results', () => {
  expect(ok('function unused(p:Promise.<uint8,string>){p.then(v=>v).then(v=>{const value:uint8=v;});}')).toBe(true);
});

test('then keeps an unknown handler result gradual', () => {
  expect(ok('function unused(p:Promise.<uint8,string>,q:any){p.then(v=>q).then(v=>{const value:string=v;});}')).toBe(true);
});

test('then assimilates the generator step before invoking the next handler', () => {
  expect(settledAfterJobs('globalThis.settled="pending";async function* g(x:uint8){yield x;return "done";}const it=g(1);it.next().then(()=>it.next()).then(r=>{globalThis.settled=r.value;}).catch(e=>{globalThis.settled=String(e);});')).toBe('done');
});

test('catch assimilates a Promise returned by recovery', () => {
  expect(settledAfterJobs('globalThis.settled="pending";const p:Promise.<uint8,string>=new Promise.<uint8,string>((resolve,reject)=>reject("reason"));const q:Promise.<uint8,string>=new Promise.<uint8,string>(resolve=>resolve(7));p.catch(()=>q).then(v=>{globalThis.settled=String(v);}).catch(e=>{globalThis.settled=String(e);});')).toBe('7');
});
