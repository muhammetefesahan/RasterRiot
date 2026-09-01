"use strict";

const RasterCore = (() => {
  const MAX_FILES = 200;
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
  const MAX_PIXELS = 16_000_000;
  const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

  const PRESETS = {
    web: { label: "Web hızlı", slug: "web", format: "image/webp", quality: 80, width: 1920, height: 0, fit: "contain" },
    square: { label: "Sosyal kare", slug: "sosyal-kare", format: "image/webp", quality: 84, width: 1080, height: 1080, fit: "cover" },
    og: { label: "OG kartı", slug: "og-karti", format: "image/webp", quality: 86, width: 1200, height: 630, fit: "cover" },
    email: { label: "E-posta", slug: "eposta", format: "image/jpeg", quality: 78, width: 1280, height: 0, fit: "contain" },
    clean: { label: "Sadece temizle", slug: "metadata-temiz", format: "source", quality: 92, width: 0, height: 0, fit: "contain" }
  };

  function clamp(value, min, max) {
    const number = Number(value);
    return Math.min(max, Math.max(min, Number.isFinite(number) ? number : min));
  }

  function humanSize(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${Math.round(value)} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
    return `${(value / 1024 ** 3).toFixed(1)} GB`;
  }

  function splitFilename(filename) {
    const safe = String(filename || "image").replace(/\\/g, "/").split("/").pop();
    const index = safe.lastIndexOf(".");
    return index > 0 ? { base: safe.slice(0, index), extension: safe.slice(index + 1) } : { base: safe, extension: "" };
  }

  function sanitizeBaseName(filename) {
    const { base } = splitFilename(filename);
    const normalized = base
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[ıİ]/g, "i")
      .replace(/[ğĞ]/g, "g")
      .replace(/[şŞ]/g, "s")
      .replace(/[çÇ]/g, "c")
      .replace(/[öÖ]/g, "o")
      .replace(/[üÜ]/g, "u")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-_.]+|[-_.]+$/g, "")
      .toLowerCase()
      .slice(0, 80);
    return normalized || "image";
  }

  function extensionFor(format, sourceName = "") {
    if (format === "image/jpeg") return "jpg";
    if (format === "image/png") return "png";
    if (format === "image/avif") return "avif";
    if (format === "source") {
      const ext = splitFilename(sourceName).extension.toLowerCase();
      return ["jpg", "jpeg", "png", "webp", "avif"].includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : "png";
    }
    return "webp";
  }

  function uniqueOutputName(sourceName, suffix, format, usedNames = new Set()) {
    const base = sanitizeBaseName(sourceName);
    const safeSuffix = sanitizeBaseName(suffix || "output");
    const extension = extensionFor(format, sourceName);
    let candidate = `${base}-${safeSuffix}.${extension}`;
    let counter = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${base}-${safeSuffix}-${counter}.${extension}`;
      counter += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  function defaultSettings() {
    return {
      preset: "web",
      format: "image/webp",
      quality: 80,
      width: 1920,
      height: 0,
      fit: "contain",
      background: "#101412",
      rotation: 0,
      flipX: false,
      flipY: false,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      grayscale: 0,
      watermark: "",
      watermarkPosition: "bottom-right",
      watermarkOpacity: 55,
      watermarkSize: 4
    };
  }

  function normalizeSettings(input = {}) {
    const defaults = defaultSettings();
    const fit = ["contain", "cover", "stretch"].includes(input.fit) ? input.fit : defaults.fit;
    const rotation = [0, 90, 180, 270].includes(Number(input.rotation)) ? Number(input.rotation) : 0;
    const positions = ["top-left", "top-right", "center", "bottom-left", "bottom-right"];
    return {
      preset: Object.hasOwn(PRESETS, input.preset) ? input.preset : defaults.preset,
      format: ["source", "image/jpeg", "image/png", "image/webp", "image/avif"].includes(input.format) ? input.format : defaults.format,
      quality: Math.round(clamp(input.quality ?? defaults.quality, 10, 100)),
      width: Math.round(clamp(input.width ?? defaults.width, 0, 12000)),
      height: Math.round(clamp(input.height ?? defaults.height, 0, 12000)),
      fit,
      background: /^#[0-9a-f]{6}$/i.test(input.background) ? input.background : defaults.background,
      rotation,
      flipX: Boolean(input.flipX),
      flipY: Boolean(input.flipY),
      brightness: Math.round(clamp(input.brightness ?? defaults.brightness, 0, 200)),
      contrast: Math.round(clamp(input.contrast ?? defaults.contrast, 0, 200)),
      saturation: Math.round(clamp(input.saturation ?? defaults.saturation, 0, 200)),
      grayscale: Math.round(clamp(input.grayscale ?? defaults.grayscale, 0, 100)),
      watermark: String(input.watermark ?? "").replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 80),
      watermarkPosition: positions.includes(input.watermarkPosition) ? input.watermarkPosition : defaults.watermarkPosition,
      watermarkOpacity: Math.round(clamp(input.watermarkOpacity ?? defaults.watermarkOpacity, 5, 100)),
      watermarkSize: Math.round(clamp(input.watermarkSize ?? defaults.watermarkSize, 1, 12))
    };
  }

  function settingsFromPreset(key, current = {}) {
    const preset = PRESETS[key] || PRESETS.web;
    return normalizeSettings({ ...current, ...preset, preset: key });
  }

  function calculateFrame(sourceWidth, sourceHeight, settingsInput = {}) {
    const settings = normalizeSettings(settingsInput);
    const rotated = settings.rotation === 90 || settings.rotation === 270;
    const sourceW = rotated ? sourceHeight : sourceWidth;
    const sourceH = rotated ? sourceWidth : sourceHeight;
    let targetW = settings.width || sourceW;
    let targetH = settings.height || (settings.width ? Math.round(sourceH * (settings.width / sourceW)) : sourceH);
    if (!settings.width && settings.height) targetW = Math.round(sourceW * (settings.height / sourceH));
    targetW = Math.max(1, targetW);
    targetH = Math.max(1, targetH);

    const pixelScale = Math.min(1, Math.sqrt(MAX_PIXELS / (targetW * targetH)));
    targetW = Math.max(1, Math.round(targetW * pixelScale));
    targetH = Math.max(1, Math.round(targetH * pixelScale));

    let drawW = targetW;
    let drawH = targetH;
    if (settings.fit !== "stretch") {
      const scale = settings.fit === "cover"
        ? Math.max(targetW / sourceW, targetH / sourceH)
        : Math.min(targetW / sourceW, targetH / sourceH);
      drawW = Math.max(1, Math.round(sourceW * scale));
      drawH = Math.max(1, Math.round(sourceH * scale));
      if (!settings.width || !settings.height) {
        targetW = drawW;
        targetH = drawH;
      }
    }

    return {
      canvasWidth: targetW,
      canvasHeight: targetH,
      drawWidth: drawW,
      drawHeight: drawH,
      offsetX: Math.round((targetW - drawW) / 2),
      offsetY: Math.round((targetH - drawH) / 2),
      pixelLimited: pixelScale < 1
    };
  }

  function validateFiles(files, existingBytes = 0, existingCount = 0) {
    const accepted = [];
    const rejected = [];
    let totalBytes = existingBytes;
    for (const file of [...files]) {
      if (existingCount + accepted.length >= MAX_FILES) {
        rejected.push({ file, reason: `En fazla ${MAX_FILES} dosya eklenebilir.` });
      } else if (!ACCEPTED_TYPES.has(file.type)) {
        const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
        rejected.push({ file, reason: heic ? "HEIC/HEIF tarayıcıda desteklenmiyor; önce JPEG'e çevir." : "Desteklenmeyen görsel formatı." });
      } else if (file.size > MAX_FILE_BYTES) {
        rejected.push({ file, reason: `Dosya ${humanSize(MAX_FILE_BYTES)} sınırını aşıyor.` });
      } else if (totalBytes + file.size > MAX_TOTAL_BYTES) {
        rejected.push({ file, reason: `Toplam güvenli bellek bütçesi ${humanSize(MAX_TOTAL_BYTES)}.` });
      } else {
        accepted.push(file);
        totalBytes += file.size;
      }
    }
    return { accepted, rejected, totalBytes };
  }

  function savingsPercent(before, after) {
    if (!before || after >= before) return 0;
    return Math.round((1 - (after / before)) * 100);
  }

  return {
    MAX_FILES,
    MAX_FILE_BYTES,
    MAX_TOTAL_BYTES,
    MAX_PIXELS,
    ACCEPTED_TYPES,
    PRESETS,
    clamp,
    humanSize,
    splitFilename,
    sanitizeBaseName,
    extensionFor,
    uniqueOutputName,
    defaultSettings,
    normalizeSettings,
    settingsFromPreset,
    calculateFrame,
    validateFiles,
    savingsPercent
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RasterCore;
if (typeof window !== "undefined") window.RasterCore = RasterCore;
