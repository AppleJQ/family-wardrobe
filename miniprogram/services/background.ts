export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
/** Conservative border flood fill; complex scenes retain the original for manual cropping. */
export function removeSimpleBackground(image: Pixels): { data: Uint8ClampedArray; changed: boolean } {
  const { width, height, data } = image;
  if (width < 3 || height < 3 || data.length !== width * height * 4 || width * height > 1000000) throw new Error('图片尺寸无效');
  const output = data.slice(), samples: number[] = [];
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 20))) samples.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 20))) samples.push(y * width, y * width + width - 1);
  const channel = (offset: number) => samples.map(index => data[index * 4 + offset]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  const background = [channel(0), channel(1), channel(2)];
  const similar = (index: number) => background.every((color, offset) => Math.abs(data[index * 4 + offset] - color) <= 32);
  if (samples.filter(similar).length < samples.length * .9) return { data: output, changed: false };
  const visited = new Uint8Array(width * height), queue = new Uint32Array(width * height);
  let head = 0, tail = 0;
  const add = (index: number) => { if (!visited[index]) { visited[index] = 1; if (similar(index)) queue[tail++] = index; } };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width);
    output[index * 4 + 3] = 0;
    if (x > 0) add(index - 1); if (x + 1 < width) add(index + 1);
    if (y > 0) add(index - width); if (y + 1 < height) add(index + width);
  }
  // Avoid returning a nearly empty garment when foreground resembles the background.
  if (tail < width * height * .05 || tail > width * height * .95) return { data: data.slice(), changed: false };
  return { data: output, changed: true };
}
