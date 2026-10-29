const { inflateRawSync } = require('node:zlib');

function readApkMetadata(apk) {
  let end = apk.length - 22;
  while (end >= Math.max(0, apk.length - 65557) && apk.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, apk.length - 65557)) throw new Error('Invalid APK ZIP');
  let central = apk.readUInt32LE(end + 16), xml;
  for (let n = 0; n < apk.readUInt16LE(end + 10); n++) {
    if (apk.readUInt32LE(central) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const length = apk.readUInt16LE(central + 28), name = apk.toString('utf8', central + 46, central + 46 + length);
    if (name === 'AndroidManifest.xml') {
      const local = apk.readUInt32LE(central + 42), size = apk.readUInt32LE(central + 20);
      const start = local + 30 + apk.readUInt16LE(local + 26) + apk.readUInt16LE(local + 28);
      const bytes = apk.subarray(start, start + size), method = apk.readUInt16LE(central + 10);
      xml = method === 8 ? inflateRawSync(bytes, { maxOutputLength: 4 * 1024 * 1024 }) : method === 0 ? bytes : null;
      break;
    }
    central += 46 + length + apk.readUInt16LE(central + 30) + apk.readUInt16LE(central + 32);
  }
  if (!xml || xml.readUInt16LE(0) !== 3) throw new Error('Missing binary AndroidManifest.xml');
  let strings = [];
  for (let offset = xml.readUInt16LE(2); offset + 8 <= xml.length;) {
    const type = xml.readUInt16LE(offset), header = xml.readUInt16LE(offset + 2), size = xml.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > xml.length) throw new Error('Invalid Android manifest chunk');
    if (type === 1) {
      const count = xml.readUInt32LE(offset + 8), utf8 = !!(xml.readUInt32LE(offset + 16) & 0x100), start = xml.readUInt32LE(offset + 20);
      if (count > size / 4) throw new Error('Invalid string count');
      strings = Array.from({ length: count }, (_, index) => {
        let cursor = offset + start + xml.readUInt32LE(offset + header + index * 4);
        const readLength = () => {
          if (utf8) { const first = xml[cursor++]; return first & 0x80 ? ((first & 0x7f) << 8) | xml[cursor++] : first; }
          const first = xml.readUInt16LE(cursor); cursor += 2;
          if (!(first & 0x8000)) return first;
          const second = xml.readUInt16LE(cursor); cursor += 2; return (first & 0x7fff) * 65536 + second;
        };
        let length = readLength(); if (utf8) length = readLength();
        return xml.toString(utf8 ? 'utf8' : 'utf16le', cursor, cursor + length * (utf8 ? 1 : 2));
      });
    } else if (type === 0x0102 && strings[xml.readUInt32LE(offset + 20)] === 'manifest') {
      const values = {}, count = xml.readUInt16LE(offset + 28), stride = xml.readUInt16LE(offset + 26);
      if (stride < 20) throw new Error('Invalid manifest attributes');
      for (let index = 0; index < count; index++) {
        const attr = offset + 16 + xml.readUInt16LE(offset + 24) + index * stride;
        const name = strings[xml.readUInt32LE(attr + 4)], raw = xml.readUInt32LE(attr + 8), kind = xml[attr + 15], data = xml.readUInt32LE(attr + 16);
        values[name] = raw !== 0xffffffff ? strings[raw] : kind === 3 ? strings[data] : data;
      }
      return { packageName: values.package, versionCode: Number(values.versionCode), versionName: values.versionName };
    }
    offset += size;
  }
  throw new Error('Android manifest metadata missing');
}
module.exports = { readApkMetadata };
