import { crc32, utf8 } from './archive';
import { Pixels } from './background';

function join(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function uint32(value: number): Uint8Array { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes; }
function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = join([utf8(type), data]);
  return join([uint32(data.length), body, uint32(crc32(body))]);
}
export function encodePng(image: Pixels): Uint8Array {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1000000 || data.length !== width * height * 4) throw new Error('透明图片尺寸无效');
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let start = 0; start < raw.length; start += 65535) {
    const length = Math.min(65535, raw.length - start), block = new Uint8Array(5), blockView = new DataView(block.buffer);
    block[0] = start + length === raw.length ? 1 : 0; blockView.setUint16(1, length, true); blockView.setUint16(3, (~length) & 65535, true);
    blocks.push(block, raw.subarray(start, start + length));
  }
  let a = 1, b = 0;
  for (const byte of raw) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  blocks.push(uint32(((b << 16) | a) >>> 0));
  return join([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', join(blocks)), chunk('IEND', new Uint8Array(0))]);
}
