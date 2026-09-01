"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { crc32, buildZip } = require("../src/zip.js");

test("CRC32 bilinen kontrol vektörünü üretir", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("geçerli başlıklar ve UTF-8 dosya adıyla ZIP üretir", async () => {
  const blob = await buildZip([{ name: "görsel.webp", data: new Uint8Array([1, 2, 3, 4]) }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(blob.type, "application/zip");
});

test("boş ZIP yerine açık hata verir", async () => {
  await assert.rejects(() => buildZip([]), /en az bir dosya/);
});
