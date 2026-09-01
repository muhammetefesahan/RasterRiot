"use strict";

const RasterZip = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }

  function crc32(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, date: day };
  }

  function concat(parts, length) {
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function localHeader(nameBytes, data, crc, stamp) {
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);
    return header;
  }

  function centralHeader(nameBytes, data, crc, stamp, offset) {
    const header = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, data.length, true);
    view.setUint32(24, data.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, offset, true);
    header.set(nameBytes, 46);
    return header;
  }

  async function buildZip(entries) {
    if (!Array.isArray(entries) || entries.length === 0) throw new Error("ZIP için en az bir dosya gerekli.");
    if (entries.length > 65535) throw new Error("Klasik ZIP dosya sınırı aşıldı.");
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localLength = 0;
    let centralLength = 0;
    const stamp = dosDateTime();

    for (const entry of entries) {
      const nameBytes = encoder.encode(String(entry.name));
      const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
      const crc = crc32(data);
      const local = localHeader(nameBytes, data, crc, stamp);
      const central = centralHeader(nameBytes, data, crc, stamp, localLength);
      localParts.push(local, data);
      centralParts.push(central);
      localLength += local.length + data.length;
      centralLength += central.length;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralLength, true);
    endView.setUint32(16, localLength, true);
    endView.setUint16(20, 0, true);

    const total = localLength + centralLength + end.length;
    return new Blob([concat([...localParts, ...centralParts, end], total)], { type: "application/zip" });
  }

  return { crc32, dosDateTime, buildZip };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RasterZip;
if (typeof window !== "undefined") window.RasterZip = RasterZip;
