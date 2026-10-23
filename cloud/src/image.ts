import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { BusinessError } from './service';

export const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_PIXELS = 4000000;
function orientation(segment: Buffer): number {
  try {
    if (segment.subarray(0, 6).toString('binary') !== 'Exif\0\0') return 1;
    const tiff = segment.subarray(6), le = tiff.toString('ascii', 0, 2) === 'II';
    const u16 = (offset: number) => le ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
    const u32 = (offset: number) => le ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
    if (u16(2) !== 42) return 1;
    const offset = u32(4), count = Math.min(u16(offset), 256);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (u16(entry) === 0x112 && u16(entry + 2) === 3 && u32(entry + 4) === 1) {
        const value = u16(entry + 8); return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch { /* Malformed EXIF is discarded, never copied to the stored image. */ }
  return 1;
}
function jpegInfo(bytes: Buffer) {
  let offset = 2, rotate = 1, width = 0, height = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error('JPEG segment');
    const segment = bytes.subarray(offset + 2, offset + length);
    if (marker === 0xe1) rotate = orientation(segment);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) { height = segment.readUInt16BE(1); width = segment.readUInt16BE(3); }
    offset += length;
  }
  return { width, height, rotate };
}
export async function normalizeImage(base64: string): Promise<Buffer> {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new Error('base64');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES || bytes.length < 24) throw new Error('size');
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = bytes[0] === 255 && bytes[1] === 216;
    if (!isPng && !isJpeg) throw new Error('format');
    const info = isPng ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), rotate: 1 } : jpegInfo(bytes);
    if (!info.width || !info.height || info.width * info.height > MAX_PIXELS) throw new Error('pixels');
    if (isPng && bytes.includes(Buffer.from('acTL'))) throw new Error('animated');
    const raw = isPng ? PNG.sync.read(bytes, { checkCRC: true }) : jpeg.decode(bytes, { useTArray: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 64 });
    const swap = info.rotate >= 5, orientedW = swap ? raw.height : raw.width, orientedH = swap ? raw.width : raw.height;
    const scale = Math.min(1, 1600 / orientedW, 1600 / orientedH);
    const width = Math.max(1, Math.round(orientedW * scale)), height = Math.max(1, Math.round(orientedH * scale));
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const ox = Math.min(orientedW - 1, Math.floor(x / scale)), oy = Math.min(orientedH - 1, Math.floor(y / scale));
      let sx = ox, sy = oy;
      switch (info.rotate) {
        case 2: sx = raw.width - 1 - ox; break;
        case 3: sx = raw.width - 1 - ox; sy = raw.height - 1 - oy; break;
        case 4: sy = raw.height - 1 - oy; break;
        case 5: sx = oy; sy = ox; break;
        case 6: sx = oy; sy = raw.height - 1 - ox; break;
        case 7: sx = raw.width - 1 - oy; sy = raw.height - 1 - ox; break;
        case 8: sx = raw.width - 1 - oy; sy = ox; break;
      }
      const from = (sy * raw.width + sx) * 4, to = (y * width + x) * 4, alpha = raw.data[from + 3] / 255;
      for (let channel = 0; channel < 3; channel++) data[to + channel] = Math.round(raw.data[from + channel] * alpha + 255 * (1 - alpha));
      data[to + 3] = 255;
    }
    return Buffer.from(jpeg.encode({ width, height, data }, 82).data);
  } catch { throw new BusinessError('INVALID_IMAGE', '请选择小于 512 KB、400 万像素以内的 JPG 或 PNG 静态衣物照片'); }
}
