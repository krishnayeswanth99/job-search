/*
 * Job Copilot: a small PDF writer for the tailored resume and cover letter (no libraries).
 *
 * Plain one-column text in Helvetica (built into every PDF reader), real text that applicant
 * tracking systems can read, US Letter, automatic line wrapping and page breaks.
 *
 *   JC.pdf.resume(doc)   doc from JC.draft.resumeDoc()      -> Uint8Array
 *   JC.pdf.letter({ name, contact, date, body })            -> Uint8Array
 *   JC.pdf.toBase64(bytes)
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  // Helvetica glyph widths (1/1000 em) for ASCII 32..126.
  const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  // Characters outside ASCII that WinAnsiEncoding has (curly quotes, dashes, bullet, Latin-1).
  const WIN = { '•': 149, '–': 150, '—': 151, '‘': 145, '’': 146, '“': 147, '”': 148, '…': 133, '€': 128 };

  function enc(s) {
    let out = '';
    for (const ch of String(s || '').normalize('NFC')) {
      const c = ch.codePointAt(0);
      if (c >= 32 && c <= 126) out += ch;
      else if (WIN[ch]) out += String.fromCharCode(WIN[ch]);
      else if (c >= 160 && c <= 255) out += ch;
      else if (/\s/.test(ch)) out += ' ';
      else {
        const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        out += /^[\x20-\x7e]$/.test(plain) ? plain : '?';
      }
    }
    return out;
  }
  const width = (s, size, bold) => {
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      w += c >= 32 && c <= 126 ? W[c - 32] : c === 149 ? 350 : 556;
    }
    return (w * size * (bold ? 1.06 : 1)) / 1000;
  };
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  function wrap(text, size, bold, maxW) {
    const out = [];
    for (const para of enc(text).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        const t = line ? line + ' ' + word : word;
        if (width(t, size, bold) <= maxW || !line) line = t;
        else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  }

  /** Lay out blocks onto Letter pages; returns PDF bytes. */
  function build(blocks) {
    const PW = 612;
    const PH = 792;
    const M = 54;
    const maxW = PW - 2 * M;
    const pages = [];
    let ops = [];
    let y = PH - M;
    const newPage = () => {
      if (ops.length) pages.push(ops);
      ops = [];
      y = PH - M;
    };
    const text = (x, yy, s, size, bold) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${esc(s)}) Tj ET`);
    const need = (h) => {
      if (y - h < M) newPage();
    };
    for (const b of blocks) {
      const size = b.size || 10.5;
      const lead = size * 1.32;
      if (b.gap) y -= b.gap;
      if (b.t === 'rule') {
        need(6);
        ops.push(`0.6 w ${M} ${y.toFixed(1)} m ${PW - M} ${y.toFixed(1)} l S`);
        y -= 8;
        continue;
      }
      if (b.t === 'entry') {
        // Left text bold, right text (dates) right-aligned on the same line.
        need(lead);
        const right = enc(b.right || '');
        const rw = width(right, size - 1, false);
        const left = wrap(b.left, size, true, maxW - rw - 12);
        left.forEach((l, k) => {
          need(lead);
          text(M, y - size, l, size, true);
          if (k === 0 && right) text(PW - M - rw, y - size, right, size - 1, false);
          y -= lead;
        });
        continue;
      }
      const indent = b.t === 'bullet' ? 12 : 0;
      const lines = wrap(b.text, size, !!b.bold, maxW - indent);
      lines.forEach((l, k) => {
        need(lead);
        if (b.t === 'bullet' && k === 0) text(M + 2, y - size, '\u0095', size, false);
        const x = b.center ? (PW - width(l, size, !!b.bold)) / 2 : M + indent;
        text(x, y - size, l, size, !!b.bold);
        y -= lead;
      });
    }
    newPage();

    // Objects: 1 catalog, 2 pages, 3-4 fonts, then page + content pairs.
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    const kids = [];
    pages.forEach((p, i) => {
      const pageId = 5 + i * 2;
      const contId = pageId + 1;
      const stream = p.join('\n');
      objs[contId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contId} 0 R >>`;
      kids.push(`${pageId} 0 R`);
    });
    objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offs = [];
    for (let i = 1; i < objs.length; i++) {
      offs[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }

  function resume(doc) {
    const b = [];
    b.push({ t: 'line', text: doc.name || '', size: 18, bold: true, center: true });
    if (doc.contact && doc.contact.length) b.push({ t: 'line', text: doc.contact.join('  |  '), size: 9, center: true, gap: 2 });
    const section = (title) => {
      b.push({ t: 'line', text: title.toUpperCase(), size: 10.5, bold: true, gap: 10 });
      b.push({ t: 'rule' });
    };
    if (doc.summary) {
      section('Summary');
      b.push({ t: 'para', text: doc.summary });
    }
    if (doc.experience && doc.experience.length) {
      section('Experience');
      doc.experience.forEach((e, i) => {
        b.push({ t: 'entry', left: e.heading, right: e.meta, gap: i ? 6 : 0 });
        for (const x of e.bullets || []) b.push({ t: 'bullet', text: x });
      });
    }
    if (doc.education && doc.education.length) {
      section('Education');
      for (const e of doc.education) b.push({ t: 'entry', left: e.heading, right: e.meta });
    }
    if (doc.skills && doc.skills.length) {
      section('Skills');
      b.push({ t: 'para', text: doc.skills.join(', ') });
    }
    if (doc.languages) {
      section('Languages');
      b.push({ t: 'para', text: doc.languages });
    }
    return build(b);
  }

  function letter({ name, contact, date, body }) {
    const b = [{ t: 'line', text: name || '', size: 14, bold: true }];
    if (contact && contact.length) b.push({ t: 'line', text: contact.join('  |  '), size: 9, gap: 2 });
    b.push({ t: 'line', text: date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), gap: 18 });
    String(body || '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach((p, i) => b.push({ t: 'para', text: p, size: 11, gap: i === 0 ? 14 : 9 }));
    return build(b);
  }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
  }

  JC.pdf = { build, resume, letter, toBase64, wrap, enc };
  if (typeof module !== 'undefined' && module.exports) module.exports = JC.pdf;
})(typeof globalThis !== 'undefined' ? globalThis : self);
