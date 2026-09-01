"use strict";

const core = window.RasterCore;
const zip = window.RasterZip;
const elements = Object.fromEntries([
  "drop-zone", "file-input", "add-more", "queue-list", "queue-count", "announcer", "toast",
  "support-note", "settings-form", "format", "quality", "quality-output", "width", "height",
  "fit", "background", "rotation", "flip-x", "flip-y", "brightness", "brightness-output",
  "contrast", "contrast-output", "saturation", "saturation-output", "grayscale", "grayscale-output",
  "watermark", "watermark-position", "watermark-opacity", "watermark-opacity-output", "watermark-size",
  "empty-preview", "before-image", "after-image", "after-layer", "compare-divider", "compare-slider",
  "compare-toggle", "source-size", "output-size", "savings", "dimensions", "format-proof",
  "batch-counter", "batch-status", "batch-progress", "process-button", "cancel-button", "result-summary",
  "quick-download"
].map((id) => [id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

let items = [];
let selectedId = null;
let settings = core.defaultSettings();
let previewTimer = 0;
let previewRevision = 0;
let batchRunning = false;
let cancelRequested = false;
let toastTimer = 0;
const formatSupport = { "image/png": true, "image/jpeg": true, "image/webp": false, "image/avif": false };

function showToast(message, tone = "info") {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 4600);
}

function announce(message) {
  elements.announcer.textContent = "";
  window.setTimeout(() => { elements.announcer.textContent = message; }, 30);
}

function selectedItem() {
  return items.find((item) => item.id === selectedId) || null;
}

function statusLabel(item) {
  if (item.status === "processing") return "İŞLENİYOR";
  if (item.status === "done") return "HAZIR";
  if (item.status === "error") return "HATA";
  return "BEKLİYOR";
}

function clearItemUrls(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
}

function renderQueue() {
  elements.queueList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "queue-empty";
    empty.textContent = "Kuyruk boş. PNG, JPEG, WebP veya AVIF ekle.";
    elements.queueList.append(empty);
  }

  items.forEach((item, index) => {
    const option = document.createElement("div");
    option.className = `queue-item${item.id === selectedId ? " selected" : ""}${item.status === "error" ? " has-error" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", item.id === selectedId ? "true" : "false");
    option.dataset.id = item.id;
    option.tabIndex = item.id === selectedId ? 0 : -1;

    const choose = document.createElement("button");
    choose.className = "queue-select";
    choose.type = "button";
    choose.setAttribute("aria-label", `${item.file.name} görselini seç`);
    choose.innerHTML = `<span class="queue-thumb">${String(index + 1).padStart(2, "0")}</span><span class="queue-copy"><strong></strong><small></small></span><span class="queue-state"></span>`;
    choose.querySelector("strong").textContent = item.file.name;
    choose.querySelector("small").textContent = item.error || `${core.humanSize(item.file.size)}${item.width ? ` · ${item.width}×${item.height}` : ""}`;
    choose.querySelector(".queue-state").textContent = statusLabel(item);
    choose.addEventListener("click", () => selectItem(item.id, true));

    const remove = document.createElement("button");
    remove.className = "queue-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${item.file.name} görselini kaldır`);
    remove.addEventListener("click", (event) => { event.stopPropagation(); removeItem(item.id); });
    option.append(choose, remove);
    option.addEventListener("focus", () => selectItem(item.id, false));
    elements.queueList.append(option);
  });

  elements.queueCount.value = String(items.length).padStart(2, "0");
  elements.processButton.disabled = !items.length || batchRunning;
  if (!batchRunning && !elements.resultSummary.textContent) updateBatchCounter(0, items.length);
}

function selectItem(id, focus = false) {
  if (!items.some((item) => item.id === id)) return;
  selectedId = id;
  renderQueue();
  if (focus) elements.queueList.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus();
  schedulePreview(0);
}

function removeItem(id) {
  if (batchRunning) return;
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return;
  clearItemUrls(items[index]);
  items.splice(index, 1);
  elements.resultSummary.textContent = "";
  elements.batchStatus.textContent = "Hazır";
  if (selectedId === id) selectedId = items[Math.min(index, items.length - 1)]?.id || null;
  renderQueue();
  if (selectedId) schedulePreview(0);
  else resetPreview();
  announce("Görsel kuyruktan kaldırıldı.");
}

function updateBatchCounter(done, total) {
  elements.batchCounter.textContent = `[${String(done).padStart(3, "0")}/${String(total).padStart(3, "0")}]`;
  elements.batchProgress.max = Math.max(1, total);
  elements.batchProgress.value = done;
}

function addFiles(fileList) {
  const existingBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  const result = core.validateFiles(fileList, existingBytes, items.length);
  elements.resultSummary.textContent = "";
  elements.batchStatus.textContent = "Hazır";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  result.accepted.forEach((file, index) => items.push({
    id: `${stamp}-${index}`,
    file,
    url: URL.createObjectURL(file),
    width: 0,
    height: 0,
    status: "ready",
    error: "",
    outputBlob: null,
    outputUrl: "",
    outputWidth: 0,
    outputHeight: 0,
    outputFormat: ""
  }));
  if (!selectedId && items.length) selectedId = items[0].id;
  renderQueue();
  if (result.accepted.length) {
    announce(`${result.accepted.length} görsel kuyruğa eklendi.`);
    schedulePreview(0);
    if (result.totalBytes > 200 * 1024 * 1024) showToast("Büyük kuyruk: sekmenin bellek kullanımı yükselebilir.", "warn");
  }
  if (result.rejected.length) {
    const first = result.rejected[0].reason;
    showToast(`${result.rejected.length} dosya atlandı. ${first}`, "warn");
  }
  elements.fileInput.value = "";
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch (_) { /* Safari fallback below. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error(`${mime} çıktısı bu tarayıcıda üretilemedi.`)),
    mime,
    quality / 100
  ));
}

function effectiveFormat(item, requested) {
  const desired = requested === "source" ? item.file.type : requested;
  return formatSupport[desired] ? desired : "image/png";
}

function drawWatermark(context, width, height, current) {
  const text = current.watermark.trim();
  if (!text) return;
  const fontSize = Math.max(12, Math.min(180, Math.round(width * current.watermarkSize / 100)));
  const margin = Math.max(14, Math.round(fontSize * 0.65));
  context.save();
  context.globalAlpha = current.watermarkOpacity / 100;
  context.fillStyle = "#ffffff";
  context.shadowColor = "rgba(0,0,0,.78)";
  context.shadowBlur = Math.max(2, Math.round(fontSize * 0.12));
  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  context.textBaseline = "middle";
  const measured = context.measureText(text).width;
  const positions = {
    "top-left": [margin, margin + fontSize / 2],
    "top-right": [width - margin - measured, margin + fontSize / 2],
    center: [(width - measured) / 2, height / 2],
    "bottom-left": [margin, height - margin - fontSize / 2],
    "bottom-right": [width - margin - measured, height - margin - fontSize / 2]
  };
  const [x, y] = positions[current.watermarkPosition];
  context.fillText(text, Math.max(margin, x), y);
  context.restore();
}

async function processImage(item, currentSettings) {
  const decoded = await decodeImage(item.file);
  let canvas;
  try {
    item.width = decoded.width;
    item.height = decoded.height;
    const current = core.normalizeSettings(currentSettings);
    const frame = core.calculateFrame(decoded.width, decoded.height, current);
    canvas = document.createElement("canvas");
    canvas.width = frame.canvasWidth;
    canvas.height = frame.canvasHeight;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas desteği bulunamadı.");
    const outputFormat = effectiveFormat(item, current.format);
    if (outputFormat === "image/jpeg" || (current.fit === "contain" && current.width && current.height)) {
      context.fillStyle = current.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.filter = `brightness(${current.brightness}%) contrast(${current.contrast}%) saturate(${current.saturation}%) grayscale(${current.grayscale}%)`;
    const rotated = current.rotation === 90 || current.rotation === 270;
    const imageW = rotated ? frame.drawHeight : frame.drawWidth;
    const imageH = rotated ? frame.drawWidth : frame.drawHeight;
    context.save();
    context.translate(frame.offsetX + frame.drawWidth / 2, frame.offsetY + frame.drawHeight / 2);
    context.rotate(current.rotation * Math.PI / 180);
    context.scale(current.flipX ? -1 : 1, current.flipY ? -1 : 1);
    context.drawImage(decoded.source, -imageW / 2, -imageH / 2, imageW, imageH);
    context.restore();
    context.filter = "none";
    drawWatermark(context, canvas.width, canvas.height, current);
    const blob = await canvasToBlob(canvas, outputFormat, current.quality);
    return { blob, width: canvas.width, height: canvas.height, format: outputFormat, pixelLimited: frame.pixelLimited };
  } finally {
    decoded.close();
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }
}

function resetPreview() {
  previewRevision += 1;
  elements.emptyPreview.hidden = false;
  elements.beforeImage.classList.remove("visible");
  elements.afterImage.classList.remove("visible");
  elements.compareSlider.disabled = true;
  elements.compareToggle.disabled = true;
  elements.quickDownload.disabled = true;
  elements.sourceSize.textContent = "—";
  elements.outputSize.textContent = "—";
  elements.savings.textContent = "—";
  elements.dimensions.textContent = "—";
}

function schedulePreview(delay = 210) {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(renderPreview, delay);
}

async function renderPreview() {
  const item = selectedItem();
  if (!item || batchRunning) return;
  const revision = ++previewRevision;
  elements.emptyPreview.hidden = false;
  elements.emptyPreview.querySelector("strong").textContent = "İŞLENİYOR";
  elements.emptyPreview.querySelector("p").textContent = "Yerel önizleme hazırlanıyor…";
  elements.quickDownload.disabled = true;
  try {
    const result = await processImage(item, settings);
    if (revision !== previewRevision || selectedId !== item.id) return;
    if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    item.outputBlob = result.blob;
    item.outputUrl = URL.createObjectURL(result.blob);
    item.outputWidth = result.width;
    item.outputHeight = result.height;
    item.outputFormat = result.format;
    item.status = "done";
    item.error = "";
    elements.beforeImage.src = item.url;
    elements.afterImage.src = item.outputUrl;
    elements.beforeImage.classList.add("visible");
    elements.afterImage.classList.add("visible");
    elements.emptyPreview.hidden = true;
    elements.compareSlider.disabled = false;
    elements.compareToggle.disabled = false;
    elements.quickDownload.disabled = false;
    elements.sourceSize.textContent = core.humanSize(item.file.size);
    elements.outputSize.textContent = core.humanSize(result.blob.size);
    const saving = core.savingsPercent(item.file.size, result.blob.size);
    elements.savings.textContent = saving ? `−${saving}%` : result.blob.size > item.file.size ? "Daha büyük" : "0%";
    elements.dimensions.textContent = `${result.width}×${result.height}`;
    elements.formatProof.textContent = `EXIF + GPS TEMİZ · ${result.format.split("/")[1].toUpperCase()}`;
    if (result.pixelLimited) showToast("Çıktı, güvenli 16 MP piksel bütçesine indirildi.", "warn");
    renderQueue();
  } catch (error) {
    if (revision !== previewRevision) return;
    item.status = "error";
    item.error = error instanceof Error ? error.message : "Görsel işlenemedi.";
    elements.emptyPreview.querySelector("strong").textContent = "ÖNİZLEME HATASI";
    elements.emptyPreview.querySelector("p").textContent = item.error;
    showToast(item.error, "error");
    renderQueue();
  }
}

function updateCompare(value) {
  const percent = core.clamp(value, 0, 100);
  elements.afterLayer.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
  elements.compareDivider.style.left = `${percent}%`;
}

function readSettings() {
  settings = core.normalizeSettings({
    ...settings,
    format: elements.format.value,
    quality: elements.quality.value,
    width: elements.width.value,
    height: elements.height.value,
    fit: elements.fit.value,
    background: elements.background.value,
    rotation: elements.rotation.value,
    flipX: elements.flipX.checked,
    flipY: elements.flipY.checked,
    brightness: elements.brightness.value,
    contrast: elements.contrast.value,
    saturation: elements.saturation.value,
    grayscale: elements.grayscale.value,
    watermark: elements.watermark.value,
    watermarkPosition: elements.watermarkPosition.value,
    watermarkOpacity: elements.watermarkOpacity.value,
    watermarkSize: elements.watermarkSize.value
  });
  elements.qualityOutput.value = `${settings.quality}%`;
  elements.brightnessOutput.value = `${settings.brightness}%`;
  elements.contrastOutput.value = `${settings.contrast}%`;
  elements.saturationOutput.value = `${settings.saturation}%`;
  elements.grayscaleOutput.value = `${settings.grayscale}%`;
  elements.watermarkOpacityOutput.value = `${settings.watermarkOpacity}%`;
  document.querySelectorAll(".preset").forEach((button) => button.classList.toggle("active", button.dataset.preset === settings.preset));
  schedulePreview();
}

function writeSettings() {
  elements.format.value = settings.format;
  elements.quality.value = settings.quality;
  elements.width.value = settings.width;
  elements.height.value = settings.height;
  elements.fit.value = settings.fit;
  elements.background.value = settings.background;
  elements.rotation.value = settings.rotation;
  elements.flipX.checked = settings.flipX;
  elements.flipY.checked = settings.flipY;
  elements.brightness.value = settings.brightness;
  elements.contrast.value = settings.contrast;
  elements.saturation.value = settings.saturation;
  elements.grayscale.value = settings.grayscale;
  elements.watermark.value = settings.watermark;
  elements.watermarkPosition.value = settings.watermarkPosition;
  elements.watermarkOpacity.value = settings.watermarkOpacity;
  elements.watermarkSize.value = settings.watermarkSize;
  elements.qualityOutput.value = `${settings.quality}%`;
  elements.brightnessOutput.value = `${settings.brightness}%`;
  elements.contrastOutput.value = `${settings.contrast}%`;
  elements.saturationOutput.value = `${settings.saturation}%`;
  elements.grayscaleOutput.value = `${settings.grayscale}%`;
  elements.watermarkOpacityOutput.value = `${settings.watermarkOpacity}%`;
  document.querySelectorAll(".preset").forEach((button) => button.classList.toggle("active", button.dataset.preset === settings.preset));
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function processBatch() {
  if (!items.length || batchRunning) return;
  batchRunning = true;
  cancelRequested = false;
  previewRevision += 1;
  elements.processButton.disabled = true;
  elements.cancelButton.hidden = false;
  elements.cancelButton.disabled = false;
  elements.resultSummary.textContent = "";
  const entries = [];
  const usedNames = new Set();
  let failed = 0;
  let limited = 0;
  let done = 0;
  try {
    for (const item of items) {
      if (cancelRequested) break;
      item.status = "processing";
      item.error = "";
      elements.batchStatus.textContent = item.file.name;
      renderQueue();
      try {
        const result = await processImage(item, settings);
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
        item.outputBlob = result.blob;
        item.outputUrl = URL.createObjectURL(result.blob);
        item.outputWidth = result.width;
        item.outputHeight = result.height;
        item.outputFormat = result.format;
        item.status = "done";
        limited += result.pixelLimited ? 1 : 0;
        const suffix = core.PRESETS[settings.preset]?.slug || "rasterriot";
        const name = core.uniqueOutputName(item.file.name, suffix, result.format, usedNames);
        entries.push({ name, data: new Uint8Array(await result.blob.arrayBuffer()) });
      } catch (error) {
        failed += 1;
        item.status = "error";
        item.error = error instanceof Error ? error.message : "İşleme hatası";
      }
      done += 1;
      updateBatchCounter(done, items.length);
      renderQueue();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    if (entries.length) {
      elements.batchStatus.textContent = "ZIP paketleniyor";
      const archive = await zip.buildZip(entries);
      const day = new Date().toISOString().slice(0, 10);
      triggerDownload(archive, `rasterriot-${day}.zip`);
    }
    const untouched = items.length - done;
    const message = `${entries.length} başarılı, ${failed} atlandı${untouched ? `, ${untouched} işlenmedi` : ""}.`;
    elements.resultSummary.textContent = message;
    elements.batchStatus.textContent = cancelRequested ? "Durduruldu · tamamlananlar indirildi" : "Tamamlandı";
    announce(message);
    if (limited) showToast(`${limited} görsel güvenli piksel bütçesine uyarlandı.`, "warn");
    else showToast(cancelRequested ? "İşlem durduruldu; tamamlananlar ZIP'lendi." : "ZIP hazır. Görseller cihazından çıkmadı.", "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "ZIP hazırlanamadı.";
    elements.batchStatus.textContent = "Paketleme hatası";
    elements.resultSummary.textContent = message;
    showToast(message, "error");
  } finally {
    batchRunning = false;
    elements.cancelButton.hidden = true;
    elements.cancelButton.disabled = true;
    elements.processButton.disabled = !items.length;
    renderQueue();
    if (selectedId) schedulePreview(0);
  }
}

async function detectFormats() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  for (const mime of ["image/webp", "image/avif"]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.8));
    formatSupport[mime] = Boolean(blob && blob.type === mime);
  }
  [...elements.format.options].forEach((option) => {
    if (option.value.startsWith("image/") && !formatSupport[option.value]) option.disabled = true;
  });
  const supported = Object.entries(formatSupport).filter(([, value]) => value).map(([mime]) => mime.split("/")[1].toUpperCase());
  elements.supportNote.textContent = `Bu tarayıcı çıktı desteği: ${supported.join(" · ")}${!formatSupport["image/avif"] ? " · AVIF kapalı" : ""}`;
  if (!formatSupport[settings.format]) {
    settings.format = formatSupport["image/webp"] ? "image/webp" : "image/jpeg";
    writeSettings();
  }
}

elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.addMore.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
elements.dropZone.addEventListener("dragover", (event) => { event.preventDefault(); elements.dropZone.classList.add("dragging"); });
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("dragging"));
elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("dragging");
  addFiles(event.dataTransfer.files);
});

elements.queueList.addEventListener("keydown", (event) => {
  if (!items.length) return;
  const index = Math.max(0, items.findIndex((item) => item.id === selectedId));
  if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(items.length - 1, index + 1);
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(0, index - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    selectItem(items[next].id, true);
  } else if ((event.key === "Delete" || event.key === "Backspace") && !batchRunning) {
    event.preventDefault();
    removeItem(selectedId);
  }
});

document.querySelectorAll(".preset").forEach((button) => button.addEventListener("click", () => {
  settings = core.settingsFromPreset(button.dataset.preset, settings);
  writeSettings();
  schedulePreview(0);
  announce(`${core.PRESETS[button.dataset.preset].label} reçetesi uygulandı.`);
}));

elements.settingsForm.addEventListener("input", readSettings);
elements.settingsForm.addEventListener("change", readSettings);
elements.compareSlider.addEventListener("input", () => updateCompare(elements.compareSlider.value));
elements.compareToggle.addEventListener("click", () => {
  elements.compareSlider.value = Number(elements.compareSlider.value) >= 50 ? 0 : 100;
  updateCompare(elements.compareSlider.value);
});
elements.quickDownload.addEventListener("click", () => {
  const item = selectedItem();
  if (!item?.outputBlob) return;
  const suffix = core.PRESETS[settings.preset]?.slug || "rasterriot";
  triggerDownload(item.outputBlob, core.uniqueOutputName(item.file.name, suffix, item.outputFormat));
});
elements.processButton.addEventListener("click", processBatch);
elements.cancelButton.addEventListener("click", () => {
  cancelRequested = true;
  elements.cancelButton.disabled = true;
  elements.batchStatus.textContent = "Mevcut görselden sonra duracak";
});
window.addEventListener("beforeunload", () => items.forEach(clearItemUrls));

updateCompare(50);
writeSettings();
detectFormats();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
