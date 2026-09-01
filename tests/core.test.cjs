"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("dosya adlarını güvenli ve taşınabilir hale getirir", () => {
  assert.equal(core.sanitizeBaseName("../../Çılgın Görsel (son).JPG"), "cilgin-gorsel-son");
  assert.equal(core.sanitizeBaseName("..\\..\\.env"), "env");
  assert.equal(core.extensionFor("source", "foto.JPEG"), "jpg");
});

test("çakışan çıktı adlarını deterministik biçimde ayırır", () => {
  const used = new Set();
  assert.equal(core.uniqueOutputName("A B.png", "Web", "image/webp", used), "a-b-web.webp");
  assert.equal(core.uniqueOutputName("A B.jpg", "Web", "image/webp", used), "a-b-web-2.webp");
});

test("boyutları okunabilir yazdırır", () => {
  assert.equal(core.humanSize(900), "900 B");
  assert.equal(core.humanSize(1536), "1.5 KB");
  assert.equal(core.humanSize(5 * 1024 * 1024), "5.0 MB");
});

test("reçete, gelişmiş ayarları koruyarak temel ayarları değiştirir", () => {
  const next = core.settingsFromPreset("square", { watermark: "Riot", brightness: 120 });
  assert.equal(next.width, 1080);
  assert.equal(next.height, 1080);
  assert.equal(next.fit, "cover");
  assert.equal(next.watermark, "Riot");
  assert.equal(next.brightness, 120);
});

test("contain, cover ve stretch geometrileri doğru hesaplanır", () => {
  const contain = core.calculateFrame(4000, 2000, { width: 1000, height: 1000, fit: "contain" });
  assert.deepEqual([contain.canvasWidth, contain.canvasHeight, contain.drawWidth, contain.drawHeight, contain.offsetY], [1000, 1000, 1000, 500, 250]);
  const cover = core.calculateFrame(4000, 2000, { width: 1000, height: 1000, fit: "cover" });
  assert.deepEqual([cover.drawWidth, cover.drawHeight, cover.offsetX], [2000, 1000, -500]);
  const stretch = core.calculateFrame(4000, 2000, { width: 800, height: 600, fit: "stretch" });
  assert.deepEqual([stretch.drawWidth, stretch.drawHeight], [800, 600]);
});

test("çıktıyı 16 megapiksel güvenlik bütçesine sınırlar", () => {
  const frame = core.calculateFrame(12000, 12000, { width: 12000, height: 12000, fit: "stretch" });
  assert.equal(frame.pixelLimited, true);
  assert.equal(frame.canvasWidth * frame.canvasHeight <= core.MAX_PIXELS, true);
});

test("dosya doğrulama format, tekil boyut ve toplam bellek sınırlarını uygular", () => {
  const valid = { name: "one.png", type: "image/png", size: 1000 };
  const heic = { name: "phone.heic", type: "image/heic", size: 1000 };
  const large = { name: "huge.jpg", type: "image/jpeg", size: core.MAX_FILE_BYTES + 1 };
  const result = core.validateFiles([valid, heic, large]);
  assert.equal(result.accepted.length, 1);
  assert.match(result.rejected[0].reason, /HEIC/);
  assert.match(result.rejected[1].reason, /50 MB/);
  const full = core.validateFiles([valid], core.MAX_TOTAL_BYTES, 1);
  assert.equal(full.accepted.length, 0);
  assert.match(full.rejected[0].reason, /bellek/);
});

test("ayarları temizler ve güvenli aralığa sıkıştırır", () => {
  const value = core.normalizeSettings({ quality: 900, width: -3, watermark: "ok\u0000no", watermarkOpacity: 0 });
  assert.equal(value.quality, 100);
  assert.equal(value.width, 0);
  assert.equal(value.watermark, "okno");
  assert.equal(value.watermarkOpacity, 5);
});

test("kazanç yüzdesi yalnızca küçülmeyi bildirir", () => {
  assert.equal(core.savingsPercent(1000, 610), 39);
  assert.equal(core.savingsPercent(1000, 1200), 0);
});
