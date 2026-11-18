/*
 * Job Copilot: plain text from a .docx file, no libraries.
 * A .docx is a zip; we read word/document.xml with the browser's built-in
 * DecompressionStream('deflate-raw') and turn paragraphs into lines.
 *
 *   await JC.docx.extractText(arrayBuffer) -> string
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  /** Returns the bytes of one file inside a zip archive, or null. */
  async function readZipEntry(buf, wanted) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // End of central directory: signature 0x06054b50, within the last 64 KB.
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      if (name === wanted) {
        const lNameLen = dv.getUint16(localOff + 26, true);
        const lExtraLen = dv.getUint16(localOff + 28, true);
        const start = localOff + 30 + lNameLen + lExtraLen;
        const data = u8.subarray(start, start + compSize);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new Error('unsupported zip compression method ' + method);
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function xmlToText(xml) {
    return xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>|<w:cr\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
        if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENTITIES[e] || m;
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function extractText(buf) {
    const xml = await readZipEntry(buf, 'word/document.xml');
    if (!xml) throw new Error('word/document.xml not found: is this a .docx file?');
    return xmlToText(new TextDecoder().decode(xml));
  }

  JC.docx = { extractText, readZipEntry, xmlToText };

  if (typeof module !== 'undefined' && module.exports) module.exports = JC;
})(typeof globalThis !== 'undefined' ? globalThis : self);
