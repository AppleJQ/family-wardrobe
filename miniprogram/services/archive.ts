/** UTF-8/ZIP-store encoder for native WeChat: no Node APIs or large runtime dependency. */
export function utf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of value) {
    let point = char.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | point >> 6, 0x80 | point & 63);
    else if (point < 0x10000) bytes.push(0xe0 | point >> 12, 0x80 | point >> 6 & 63, 0x80 | point & 63);
    else bytes.push(0xf0 | point >> 18, 0x80 | point >> 12 & 63, 0x80 | point >> 6 & 63, 0x80 | point & 63);
  }
  return new Uint8Array(bytes);
}
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  return crc >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
interface ZipEntry { name: Uint8Array; size: number; crc: number; offset: number }
export function createZip(write: (bytes: Uint8Array) => void) {
  const entries: ZipEntry[] = [], names = new Set<string>();
  let offset = 0, finished = false;
  function emit(bytes: Uint8Array) { write(bytes); offset += bytes.length; }
  function header(size: number) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
  return {
    add(name: string, data: Uint8Array) {
      if (finished || !name || name.includes('\\') || name.startsWith('/') || name.split('/').some(part => !part || part === '..' || part === '.') || names.has(name)) throw new Error('无效或重复的导出文件名');
      const encoded = utf8(name);
      if (encoded.length > 65535 || entries.length >= 65534 || offset + data.length > 0xffffffff) throw new Error('导出文件超过ZIP格式限制');
      const entry = { name: encoded, size: data.length, crc: crc32(data), offset };
      const local = header(30); local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true);
      local.view.setUint16(6, 0x800, true); local.view.setUint16(12, 33, true); local.view.setUint32(14, entry.crc, true);
      local.view.setUint32(18, data.length, true); local.view.setUint32(22, data.length, true); local.view.setUint16(26, encoded.length, true);
      emit(local.bytes); emit(encoded); emit(data); entries.push(entry); names.add(name);
    },
    finish() {
      if (finished) throw new Error('导出文件已结束');
      const centralOffset = offset;
      for (const entry of entries) {
        const central = header(46); central.view.setUint32(0, 0x02014b50, true); central.view.setUint16(4, 20, true);
        central.view.setUint16(6, 20, true); central.view.setUint16(8, 0x800, true); central.view.setUint16(14, 33, true);
        central.view.setUint32(16, entry.crc, true); central.view.setUint32(20, entry.size, true); central.view.setUint32(24, entry.size, true);
        central.view.setUint16(28, entry.name.length, true); central.view.setUint32(42, entry.offset, true);
        emit(central.bytes); emit(entry.name);
      }
      const end = header(22); end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, entries.length, true);
      end.view.setUint16(10, entries.length, true); end.view.setUint32(12, offset - centralOffset, true); end.view.setUint32(16, centralOffset, true);
      emit(end.bytes); finished = true;
      return offset;
    },
  };
}
