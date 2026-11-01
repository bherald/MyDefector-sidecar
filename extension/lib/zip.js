// ZIP store method (no compression); dependency-free, UTF-8 filenames, CRC32.
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size, fields) {
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  for (const [offset, value, width = 4] of fields)
    width === 2 ? view.setUint16(offset, value, true) : view.setUint32(offset, value, true);
  return bytes;
}
export function zipBundle(files) {
  if (files.length > 65535)
    throw new Error('ZIP64 is not supported; save this bundle directly to a folder.');
  const entries = [],
    central = [];
  let offset = 0,
    centralSize = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name),
      bytes = file.bytes,
      crc = crc32(bytes);
    if (name.length > 65535 || bytes.length > 0xffffffff || offset + bytes.length > 0xffffffff)
      throw new Error('ZIP64 is not supported; save directly to a folder.');
    const local = header(30, [
      [0, 0x04034b50],
      [4, 20, 2],
      [6, 0x800, 2],
      [12, 33, 2],
      [14, crc],
      [18, bytes.length],
      [22, bytes.length],
      [26, name.length, 2],
    ]);
    const directory = header(46, [
      [0, 0x02014b50],
      [4, 20, 2],
      [6, 20, 2],
      [8, 0x800, 2],
      [14, 33, 2],
      [16, crc],
      [20, bytes.length],
      [24, bytes.length],
      [28, name.length, 2],
      [42, offset],
    ]);
    entries.push(local, name, bytes);
    central.push(directory, name);
    offset += local.length + name.length + bytes.length;
    centralSize += directory.length + name.length;
  }
  if (offset + centralSize > 0xffffffff)
    throw new Error('ZIP64 is not supported; save directly to a folder.');
  const end = header(22, [
    [0, 0x06054b50],
    [8, files.length, 2],
    [10, files.length, 2],
    [12, centralSize],
    [16, offset],
  ]);
  return new Blob([...entries, ...central, end], { type: 'application/zip' });
}
