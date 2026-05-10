// Minimal ZIP writer — "stored" mode only (no DEFLATE).
// Sufficient for a handful of JSON + PNG files in a QA report bundle.
// Output is a Blob compatible with download links.
//
// Refs: PKWARE APPNOTE.TXT 4.3.7 (local file header), 4.3.12 (central directory).
(function () {
  const CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) { return new TextEncoder().encode(str); }

  function dosTime(date) {
    const t = ((date.getHours() & 0x1F) << 11)
            | ((date.getMinutes() & 0x3F) << 5)
            | ((date.getSeconds() / 2) & 0x1F);
    return t & 0xFFFF;
  }
  function dosDate(date) {
    const d = (((date.getFullYear() - 1980) & 0x7F) << 9)
            | (((date.getMonth() + 1) & 0x0F) << 5)
            | (date.getDate() & 0x1F);
    return d & 0xFFFF;
  }

  function u16(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]); }
  function u32(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]); }

  function concat(arrays) {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }

  /**
   * Build a ZIP Blob from an array of { path, data }.
   * data may be: Uint8Array | string | Blob | ArrayBuffer.
   */
  async function buildZip(entries) {
    const now = new Date();
    const localChunks = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = utf8(entry.path);
      const dataBytes = await toBytes(entry.data);
      const crc = crc32(dataBytes);
      const size = dataBytes.length;
      const time = dosTime(now);
      const date = dosDate(now);

      // Local file header
      const lfh = concat([
        u32(0x04034B50),    // signature
        u16(20),             // version needed
        u16(0),              // flags
        u16(0),              // compression: stored
        u16(time), u16(date),
        u32(crc),
        u32(size), u32(size),
        u16(nameBytes.length),
        u16(0),              // extra length
        nameBytes
      ]);
      localChunks.push(lfh, dataBytes);

      // Central directory entry — built now, written at end
      const cdEntry = concat([
        u32(0x02014B50),
        u16(20), u16(20),
        u16(0), u16(0),
        u16(time), u16(date),
        u32(crc),
        u32(size), u32(size),
        u16(nameBytes.length),
        u16(0), u16(0),       // extra, comment
        u16(0),               // disk number
        u16(0),               // internal attrs
        u32(0),               // external attrs
        u32(offset),          // local header offset
        nameBytes
      ]);
      central.push(cdEntry);

      offset += lfh.length + dataBytes.length;
    }

    const cdBytes = concat(central);
    const cdOffset = offset;
    const cdSize = cdBytes.length;

    const eocd = concat([
      u32(0x06054B50),
      u16(0), u16(0),
      u16(entries.length), u16(entries.length),
      u32(cdSize), u32(cdOffset),
      u16(0)
    ]);

    return new Blob([concat([...localChunks, cdBytes, eocd])], { type: 'application/zip' });
  }

  async function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return utf8(data);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    throw new Error('unsupported data type for zip entry');
  }

  // Reader — stored mode only, mirrors buildZip's writer.
  // Locates EOCD, walks central directory, returns [{ path, data: Uint8Array }].
  // Throws on DEFLATE-compressed entries (compression method !== 0).
  async function parseZip(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Find End Of Central Directory record by scanning backwards for its signature.
    let eocdOff = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054B50) { eocdOff = i; break; }
    }
    if (eocdOff < 0) throw new Error('zip: EOCD not found');

    const cdEntries = dv.getUint16(eocdOff + 10, true);
    const cdSize    = dv.getUint32(eocdOff + 12, true);
    const cdOffset  = dv.getUint32(eocdOff + 16, true);

    const out = [];
    let p = cdOffset;
    for (let i = 0; i < cdEntries; i++) {
      if (dv.getUint32(p, true) !== 0x02014B50) throw new Error('zip: bad central directory signature');
      const compression = dv.getUint16(p + 10, true);
      const compSize    = dv.getUint32(p + 20, true);
      const uncompSize  = dv.getUint32(p + 24, true);
      const nameLen     = dv.getUint16(p + 28, true);
      const extraLen    = dv.getUint16(p + 30, true);
      const commentLen  = dv.getUint16(p + 32, true);
      const localOff    = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;

      if (compression !== 0) throw new Error(`zip: compression method ${compression} not supported (stored only)`);

      // Local file header — read name+extra lengths to find data start.
      if (dv.getUint32(localOff, true) !== 0x04034B50) throw new Error('zip: bad local header signature');
      const lfhNameLen  = dv.getUint16(localOff + 26, true);
      const lfhExtraLen = dv.getUint16(localOff + 28, true);
      const dataOff = localOff + 30 + lfhNameLen + lfhExtraLen;
      const size = compSize || uncompSize;
      const data = bytes.subarray(dataOff, dataOff + size);
      out.push({ path: name, data });
    }
    return out;
  }

  const target = (typeof self !== 'undefined' ? self : window);
  target.QA = target.QA || {};
  target.QA.zipStore = { buildZip, parseZip };

  if (typeof module !== 'undefined') module.exports = { buildZip, parseZip };
})();
