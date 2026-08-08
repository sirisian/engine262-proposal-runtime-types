import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-memory-layout (Memory Layout), #sec-natural-alignment,
 * #sec-type-arguments-and-placement-new-in-expression-position. Design:
 * memorylayout.md.
 *
 * What a laid-out type reports about itself - size, bit width, alignment - the
 * reserved layout controls that place a class and its fields, sub-byte fields
 * and the shift-and-mask rule that reads them, and placement over bytes that
 * already exist.
 */

test('memory layout: the reserved layout controls place a class and its fields', () => {
  // GAP CLOSED. This documented that `@packed` did not parse under the feature,
  // because the `@` token was gated on the TC39 `decorators` feature alone.
  // That feature is a COMPETING decorator proposal - it calls a decorator with
  // the `(value, context)` convention where this proposal identifies one by the
  // type of its context parameter and resolves overloads - so the two are now
  // mutually exclusive and `runtime-types` supplies the grammar itself.
  //
  // The seven controls are not decorators in that semantic sense at all: they
  // name no function and take no context, they set property-descriptor keys.
  // So they are recognized syntactically and never evaluated.
  expect(evaluated('@packed class A { a: uint8; b: uint16; } String((type A).byteLength) + "/" + String((type A).alignment);')).toBe('3/1');
  expect(evaluated('@packed class A { a: uint8; b: uint16; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b").offset);')).toBe('1');
  // The design's four-control example, which exercises `alignAll`, `size`,
  // `offset`, and `align` in one declaration. `align` REPLACES a field's
  // alignment rather than strengthening it, so `y` lands at byte 8 and not at
  // 16 - taking the max is the obvious wrong implementation.
  const four = '@alignAll(16) @size(32) class A { @offset(2) x: float32; @align(4) y: float32x4; } ';
  expect(evaluated(`${four} String((type A).byteLength) + "/" + String((type A).alignment);`)).toBe('32/16');
  expect(evaluated(`${four} String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("x").offset);`)).toBe('2');
  expect(evaluated(`${four} String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("y").offset);`)).toBe('8');
  // A class with no controls is unaffected.
  expect(evaluated('class N { a: uint8; b: uint16; } String((type N).byteLength) + "/" + String((type N).alignment);')).toBe('4/2');
  // ANY OTHER DECORATOR IS REFUSED. This proposal's decorators extension -
  // context types, overload resolution, replacement by return value - is a
  // separate feature and is not implemented, and a declaration that is accepted
  // and does nothing reads as support.
  // A class decorator runs, and runs AFTER the class is built so it sees a
  // finished one. The layout controls are
  // unaffected - they are recognized syntactically and never evaluated, so a
  // class can carry both.
  expect(evaluated('const l = []; function f(c) { l.push(c.kind); } @f @packed class Z { a: uint8; b: uint16; } l.join(",") + "/" + String((type Z).byteLength);')).toBe('Class/3');
});

test('memory layout: a type reports its own byteLength', () => {
  expect(evaluated('String(uint32.byteLength);')).toBe('4');
  // THE VIEW CONSTRUCTOR. `[].<T>(buffer,
  // byteOffset, byteElementLength)` views bytes that already exist: it is a
  // call on the type rather than a `new`, because nothing is constructed.
  expect(evaluated('const b = new ArrayBuffer(4); String([].<uint8>(b).length);')).toBe('4');
});

// -- soa: structure of arrays --------------------------------------------------

test('memory layout: a laid out type reports its size, bit width, and alignment', () => {
  // memorylayout.md's own examples
  expect(evaluated('String(uint8.byteLength);')).toBe('1');
  expect(evaluated('String(uint8.bitLength);')).toBe('8');
  expect(evaluated('type U = uint.<4>; String(U.bitLength);')).toBe('4');
  // the bits rounded up to a byte
  expect(evaluated('type U = uint.<4>; String(U.byteLength);')).toBe('1');
  expect(evaluated('String(float64.byteLength);')).toBe('8');
  expect(evaluated('String(float64.alignment);')).toBe('8');
  expect(evaluated('String(float32.byteLength);')).toBe('4');
  expect(evaluated('String(boolean.byteLength);')).toBe('1');
});

test('memory layout: an unnamed width takes the natural alignment rule', () => {
  // The smallest power of two at least the byte length, and NOT capped. The
  // examples the rule was written around are unchanged.
  expect(evaluated('type U = uint.<4>; String(U.alignment);')).toBe('1');
  expect(evaluated('type U = uint.<24>; String(U.byteLength);')).toBe('3');
  expect(evaluated('type U = uint.<24>; String(U.alignment);')).toBe('4');
  // THERE IS NO CAP. One would make two 16-byte types disagree for no reason a
  // program could see: a `uint.<128>` aligned at 8 while a `float32x4` of the
  // same width aligned at 16, because the vector rule bypassed the cap. Rust,
  // which this layout follows, aligns each scalar to its own size - `u128` is
  // 16-byte aligned, matching C - and caps nothing; raising an alignment is
  // `#[repr(align(N))]`'s job, which is `@align` here.
  expect(evaluated('String(int128.byteLength);')).toBe('16');
  expect(evaluated('String(int128.alignment);')).toBe('16');
  // The vector case now FALLS OUT of the general rule rather than needing one
  // of its own, since a width that is already a power of two rounds to itself.
  expect(evaluated('type V = float32x4; String(V.alignment) + "/" + String(V.byteLength);')).toBe('16/16');
  // And a bit vector still packs: eight one-bit lanes in one byte.
  expect(evaluated('type B = boolean8; String(B.alignment) + "/" + String(B.byteLength);')).toBe('1/1');
});

test('memory layout: a fixed length array lays out as its element repeated', () => {
  expect(evaluated('type A = [4].<uint8>; String(A.byteLength);')).toBe('4');
  expect(evaluated('type A = [3].<float32>; String(A.byteLength);')).toBe('12');
  expect(evaluated('type A = [3].<float32>; String(A.alignment);')).toBe('4');
});

test('memory layout: asking a type with no layout for its size is an error', () => {
  // the point of the rule: a program asking for the size of a string has made a
  // mistake a returned number would hide
  expectThrown('string.byteLength;');
  expectThrown('bigint.byteLength;');
  expectThrown('type A = any; A.byteLength;');
  // a union of value types has no single layout
  expectThrown('type U = uint8 | uint16; U.byteLength;');
  // and an array with no length is not a laid out type, though its instances have
  // a byteLength once the buffer-backed runtime lands
  expectThrown('type A = [].<uint8>; A.byteLength;');
});

// -- simd: the named lane types --------------------------------------------------

test('memory layout: sub-byte fields pack into shared bytes', () => {
  // #sec-natural-alignment states the whole walk as a BIT cursor, not a byte
  // one: "Where the field's type has a `bitLength` under 8, it is a bit-field:
  // it is placed at the cursor, or at the bit its `offsetBit` names, and the
  // cursor advances by its `bitLength`." Writing it in bytes and special-casing
  // bit-fields is how the rounding rules drift apart; in bits the two cases
  // share one cursor.
  //
  // The design's RGB565, exactly.
  const rgb = '@packed class RGB565 { r: uint.<5>; g: uint.<6>; b: uint.<5>; } ';
  expect(evaluated(`${rgb} String((type RGB565).byteLength) + "/" + String((type RGB565).bitLength);`)).toBe('2/16');
  expect(evaluated(`${rgb} const R = (n) => Reflect.getReflection.<Reflect.ClassFieldLayout, RGB565>(n); String(R("r").offsetBit) + "/" + String(R("g").offsetBit) + "/" + String(R("b").offsetBit);`)).toBe('0/5/11');
  expect(evaluated(`${rgb} String(Reflect.getReflection.<Reflect.ClassFieldLayout, RGB565>("g").isBitField);`)).toBe('true');

  // "Automatic packing reaches only a field under 8 bits, so a `uint.<12>`
  // occupies 2 bytes unless an `offsetBit` places it." The BYTE BOUNDARY is the
  // line, not the type's name.
  expect(evaluated('class W { a: uint.<12>; } String((type W).byteLength) + "/" + String((type W).bitLength);')).toBe('2/12');
  // `offsetBit` places one explicitly, which is what fixes bit order exactly.
  expect(evaluated('@packed class E { a: uint.<3>; @offsetBit(8) b: uint.<4>; } const R = (n) => Reflect.getReflection.<Reflect.ClassFieldLayout, E>(n); String(R("a").offsetBit) + "/" + String(R("b").offsetBit) + "/" + String((type E).bitLength);')).toBe('0/8/12');

  // bitLength is now the UNROUNDED extent: a class of one `uint.<5>` is 5 bits
  // in 1 byte, where the walk previously reported 8 because it derived
  // bitLength from byteLength.
  expect(evaluated('class B { r: uint.<5>; } String((type B).bitLength) + "/" + String((type B).byteLength);')).toBe('5/1');
  // Byte-sized classes are unchanged by the rewrite.
  expect(evaluated('class N { a: uint8; b: uint16; } String((type N).byteLength) + "/" + String((type N).alignment);')).toBe('4/2');
  expect(evaluated('class V { x: float32; y: float32; z: float32; } String((type V).byteLength) + "/" + String((type V).alignment);')).toBe('12/4');
});

test('memory layout: a bit-field has no byte address to refer to', () => {
  // "Reading or writing a bit-field is a shift and a mask, and taking a
  // reference to one is a type error, since it has no byte address to refer
  // to." A reference borrows a storage LOCATION, and a field packed into part
  // of a byte is not one.
  const c = '@packed class C { r: uint.<5>; n: uint8; } const c = new C(); ';
  expectThrown(`${c} function f(p: ref uint.<5>) { return 1; } f(ref c.r);`);
  // A byte-addressable field of the same class is still borrowable, which is
  // what keeps this a rule about bit-fields rather than about typed classes.
  expect(evaluated(`${c} function g(p: ref uint8) { return 2; } String(g(ref c.n));`)).toBe('2');
  // And an ordinary object property is untouched.
  expect(evaluated('const o = { z: 1 }; function h(p: ref number) { return 3; } String(h(ref o.z));')).toBe('3');
});

test('memory layout: a placement allocation lands an instance on existing bytes', () => {
  // The placement forms of
  // #sec-type-arguments-and-placement-new-in-expression-position. The parser
  // had built these arguments since the form was added and NOTHING consumed
  // them, so a placement construction allocated fresh storage and discarded the
  // buffer it was handed - which reads as support.
  //
  // This is also the first thing in the engine that puts real BYTES under an
  // instance: every typed class before it stored its fields as ordinary
  // properties, which is why four stages could compute a layout that nothing
  // read.
  const V = 'class V { x: float32; y: float32; constructor(a, b) { this.x = a; this.y = b; } } ';
  const setup = `${V} const buf = new ArrayBuffer(32); const v = new(buf, 0) V(1.5, 2.5); const view = new Float32Array(buf); `;
  expect(evaluated(`${setup} String(view[0]) + "/" + String(view[1]);`)).toBe('1.5/2.5');
  // ALIASING, in both directions, which is the whole point: the instance's
  // fields ARE the buffer's bytes.
  expect(evaluated(`${setup} view[0] = 9.5; String(Number(v.x));`)).toBe('9.5');
  expect(evaluated(`${setup} v.y = 7.5; String(view[1]);`)).toBe('7.5');
  // The store check runs before the bytes are written, exactly as for a
  // property-backed field.
  expectThrown(`${setup} v.x = "s";`);
  // "The second, when present, is the byte offset and otherwise 0."
  expect(evaluated(`${setup} const v2 = new(buf, 16) V(3, 4); String(view[4]) + "/" + String(view[5]);`)).toBe('3/4');
  // "It is a *RangeError* exception when the extent so computed exceeds the
  // buffer's length."
  // The extent is validated BEFORE the constructor runs: it depends only on
  // the arguments and the layout, and checking afterwards would let a
  // constructor with side effects run for a placement that can never happen.
  expectThrownKind('class P { x: float32; y: float32; } new(new ArrayBuffer(4), 0) P();', 'RangeError');
  expect(evaluated('let ran = false; class P { x: float32; y: float32; constructor() { ran = true; } } try { new(new ArrayBuffer(4), 0) P(); } catch (e) {} String(ran);')).toBe('false');
  // "Bytes the layout does not assign keep the buffer's contents, since reusing
  // storage is what the form is for and the zero-fill rule of fresh allocation
  // does not apply."
  expect(evaluated('class P { x: float32; y: float32; } const b = new ArrayBuffer(32); const u = new Uint8Array(b); u[12] = 0xAB; new(b, 0) P(); String(u[12]);')).toBe('171');
});

test('memory layout: a placed bit-field is a shift and a mask', () => {
  // "Reading or writing a bit-field is a shift and a mask." That sentence needs
  // an instance with bytes to shift within, which a placement supplies.
  const rgb = '@packed class RGB { r: uint.<5>; g: uint.<6>; b: uint.<5>; } const cb = new ArrayBuffer(4); const c = new(cb, 0) RGB(); ';
  expect(evaluated(`${rgb} c.r = 31; c.g = 0; c.b = 1; String(Number(c.r)) + "/" + String(Number(c.g)) + "/" + String(Number(c.b));`)).toBe('31/0/1');
  // And the bytes are packed as the layout says: `r` fills bits 0..4 of byte 0,
  // and `b` at bit 11 is bit 3 of byte 1.
  expect(evaluated(`${rgb} c.r = 31; c.b = 1; const u = new Uint8Array(cb); String(u[0]) + "/" + String(u[1]);`)).toBe('31/8');
});

test('memory layout: a placement over a resizable buffer records its extent', () => {
  // "Over a resizable buffer the extent is recorded: shrinking the buffer below
  // a live allocation's extent detaches those instances, touching a detached
  // instance throws a *TypeError* exception, and growing never invalidates."
  const rz = 'class V { x: float32; y: float32; } const rb = new ArrayBuffer(32, { maxByteLength: 64 }); const v = new(rb, 16) V(); v.x = 1.5; ';
  expect(evaluated(`${rz} String(Number(v.x));`)).toBe('1.5');
  expect(evaluated(`${rz} rb.resize(64); String(Number(v.x));`)).toBe('1.5');
  expectThrownKind(`${rz} rb.resize(8); v.x;`, 'TypeError');
});

test('memory layout: overlapping fields reinterpret, and the store check is per field', () => {
  // #sec-layout-control: "Two fields given one `offset` occupy one memory,
  // which is the C union." This is the ONE place a typed read can produce a
  // value the type system did not construct, and the specification permits it
  // knowingly: the store check applies PER FIELD against the type that field
  // declares, and neither field knows the other shares its bytes.
  const u = '@packed class U { value: float32; @offset(0) bits: uint32; } const b = new ArrayBuffer(8); const u = new(b, 0) U(); ';
  // Both fields are placed at byte 0.
  expect(evaluated(`${u} String(Reflect.getReflection.<Reflect.ClassFieldLayout, U>("value").offset) + "/" + String(Reflect.getReflection.<Reflect.ClassFieldLayout, U>("bits").offset);`)).toBe('0/0');
  // A float written through one field is read as its BIT PATTERN through the
  // other, which is what a program overlapping two types asked for and is why
  // the C union is expressible at all. 1.0 as a float32 is 0x3F800000.
  expect(evaluated(`${u} u.value = 1; String(Number(u.bits));`)).toBe('1065353216');
  expect(evaluated(`${u} u.bits = 1065353216; String(Number(u.value));`)).toBe('1');
  // Each field still checks its OWN type: the reinterpretation is between the
  // bytes, never a way past a store boundary.
  expectThrown(`${u} u.bits = "s";`);
  expectThrown(`${u} function anyv() { return 4294967296; } u.bits = anyv();`);
});

test('memory layout: a type-position name resolves against its declaration', () => {
  // #sec-compile-time-evaluability: "Evaluation is confined to checking and
  // READS DECLARATIONS RATHER THAN RUN-TIME BINDINGS." The engine resolved a
  // type name through ResolveBinding and GetValue - the run-time binding - so a
  // name in its temporal dead zone was refused, and a class's own binding is in
  // its dead zone for the whole of its declaration.
  //
  // #sec-layout-finiteness names the case this broke: "a field written `T |
  // null` closes a cycle because it is a reference ... which is why a LINKED
  // LIST IS EXPRESSIBLE and a class containing itself by value is not."
  expect(evaluated('class N { value: uint32; next: N | null; } "ok";')).toBe('ok');
  // The refusal was never only about self-reference: a forward reference and
  // mutual recursion went with it, while a METHOD signature naming the same
  // class always worked - which is the diagnostic, since a signature is not
  // resolved at declaration and a field's type is.
  expect(evaluated('class A { b: B | null; } class B { x: uint8; } "ok";')).toBe('ok');
  expect(evaluated('class P { q: Q | null; } class Q { p: P | null; } "ok";')).toBe('ok');
  expect(evaluated('class M { m(): M | null { return null; } } "ok";')).toBe('ok');
  // The list is usable, not merely declarable.
  const list = 'class N { value: uint32; next: N | null; } const a = new N(); a.value = 5; const b = new N(); b.value = 7; a.next = b; ';
  expect(evaluated(`${list} String(Number(a.next.value));`)).toBe('7');
  expect(evaluated(`${list} String(b.next);`)).toBe('null');

  // A reference field has a WIDTH, so a class holding one has a layout: the
  // table's row "a reference type, including a nullable union of a value type
  // class" says the width is the implementation's business, and this
  // implementation spends 8 bytes at alignment 8.
  expect(evaluated('class B { x: uint8; } class R { r: B | null; } String((type R).byteLength) + "/" + String((type R).alignment);')).toBe('8/8');
  expect(evaluated('class B { x: uint8; } class R { v: uint32; r: B | null; } String((type R).byteLength) + "/" + String(Reflect.getReflection.<Reflect.ClassFieldLayout, R>("r").offset);')).toBe('16/8');
  // KNOWN LIMIT, recorded rather than asserted away: a SELF-referential class
  // declares, constructs, and links, but its own layout is not computed at its
  // declaration. The self-reference resolves to a type built from the
  // declaration, which the class's own Type Object does not yet agree with -
  // `Reflect.typeOf` over it does not report the class - so the layout walk
  // cannot complete. Nothing above depends on it, and the reference width is
  // exercised by the completed-class rows instead.
  // LIMIT CLOSED (F103). This documented that a SELF-REFERENTIAL class's own
  // layout was not computed at its declaration, because the record built from
  // the declaration and the class's finished Type Object did not intern as one.
  // They do now: identity is by [[Declaration]], so the class's completion
  // finds the earlier record and COMPLETES it with the constructor rather than
  // being handed a stale one back. The linked list lays out like any other
  // class holding a reference.
  expect(evaluated('class N { value: uint32; next: N | null; } String((type N).byteLength) + "/" + String((type N).alignment);')).toBe('16/8');
  expect(evaluated('class N { value: uint32; next: N | null; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, N>("next").offset);')).toBe('8');
});

test('memory layout: a class may not contain itself by value', () => {
  // #sec-layout-finiteness: "a value type class may not contain itself,
  // directly or through a cycle of value type fields".
  //
  // This check had NEVER HAD TO WORK. A cyclic class was refused by the
  // ordinary temporal dead zone before any layout was computed, so the
  // condition held by accident; resolving a type-position name against its
  // declaration removes the accident and leaves the clause to be enforced.
  expectThrownKind('class C { self: C; }', 'TypeError');
  // The distinction the clause draws: a REFERENCE to the same class closes the
  // cycle and is fine, because the recursion stops at a type with no layout of
  // its own rather than descending.
  expect(evaluated('class D { self: D | null; } "ok";')).toBe('ok');
  // A FORWARD reference by value is not a cycle. Its layout is simply not
  // computable at that declaration, so the class reports none rather than
  // being refused - being wrong in that direction costs precision, being wrong
  // in the other would refuse a program the clause admits.
  expect(evaluated('class P2 { q: Q2; } class Q2 { x: uint8; } "ok";')).toBe('ok');
});

test('memory layout: a placement binds before construction, so no property is created', () => {
  // "Construction stores each field of each instance at its laid-out position."
  // The first implementation constructed into fresh storage and moved the
  // fields afterwards, which left each constructor-written property behind as a
  // stale copy that could not be deleted - #sec-typed-storage makes deleting a
  // typed field a TypeError. Binding between the instance being created and its
  // fields being initialized removes the intermediate state rather than
  // cleaning up after it, which is what C++ placement `new` does: the object is
  // constructed directly in the supplied storage.
  const V = 'class V { x: float32; y: float32; constructor(a, b) { this.x = a; this.y = b; } } const b = new ArrayBuffer(32); const v = new(b, 0) V(1.5, 2.5); ';
  expect(evaluated(`${V} String(Object.getOwnPropertyNames(v).length);`)).toBe('0');
  expect(evaluated(`${V} String(Number(v.x)) + "/" + String(new Float32Array(b)[1]);`)).toBe('1.5/2.5');
  // A class with NO constructor is created on a different path - inside the
  // default constructor builtin rather than in [[Construct]] - and a placement
  // has to be taken on both. Missing the second left such a class placed in
  // name only: its fields became properties and its buffer stayed zero.
  const D = 'class D { x: float32; } const b2 = new ArrayBuffer(8); const d = new(b2, 0) D(); d.x = 1.5; ';
  expect(evaluated(`${D} String(Object.getOwnPropertyNames(d).length);`)).toBe('0');
  expect(evaluated(`${D} String(new Float32Array(b2)[0]);`)).toBe('1.5');
  // A constructor now reads back through the BUFFER, which is what a placed
  // instance should do for the whole of its life rather than from the end of
  // construction onwards.
  expect(evaluated('let seen = 0; class W { p: uint8; constructor() { this.p = 3; seen = Number(this.p); } } const b3 = new ArrayBuffer(8); new(b3, 0) W(); String(seen);')).toBe('3');
  // An unplaced instance is untouched.
  expect(evaluated('class U { x: float32; } String(Object.getOwnPropertyNames(new U()).join(","));')).toBe('x');
});
