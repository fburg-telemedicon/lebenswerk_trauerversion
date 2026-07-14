// Erzeugt eine .xlsx mit Aufwandsschätzungen (Spalten N & O) zur manuellen Übernahme
// ins Master-Sheet. Bezug zur Ursprungstabelle über Spalte A (Nr.).
//
// Aufruf:  node tools/aufwand-xlsx.mjs <data.json> <out.xlsx>
//
// data.json: { "rows": [ ["1","Kurzbeschreibung","0,4","1,0"], ... ] }
//   Spalte 0 = Nr. (aus Spalte A des Master-Sheets)
//   Spalte 1 = Kurzbeschreibung (zur Zuordnung, damit man Änderungen am Master bemerkt)
//   Spalte 2 = Spalte N: Dein Aufwand (h, Komma-Dezimal als Text)
//   Spalte 3 = Spalte O: Mein Coding-Aufwand (h, Komma-Dezimal als Text)
//
// Werte werden bewusst als Text (Komma-Dezimal) gespeichert; deutsches Excel
// interpretiert sie beim Einfügen automatisch als Zahl.

import { writeFileSync, readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

const dataFile = process.argv[2];
const outFile = process.argv[3];
if (!dataFile || !outFile) {
  console.error("Aufruf: node tools/aufwand-xlsx.mjs <data.json> <out.xlsx>");
  process.exit(1);
}

const header = [
  "Nr. (Spalte A)",
  "Beschreibung (Kurz, zur Zuordnung)",
  "Spalte N - Dein Aufwand (h)",
  "Spalte O - Mein Coding-Aufwand (h)",
];
const rows = [header, ...JSON.parse(readFileSync(dataFile, "utf8")).rows];

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colLetter = (i) => String.fromCharCode(65 + i);
const cell = (ref, val, isHeader) =>
  `<c r="${ref}"${isHeader ? ' s="1"' : ""} t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;

const sheetRows = rows
  .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(colLetter(ci) + (ri + 1), v, ri === 0)).join("")}</row>`)
  .join("");

const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="55" customWidth="1"/><col min="3" max="4" width="26" customWidth="1"/></cols>
<sheetData>${sheetRows}</sheetData></worksheet>`;

const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Aufwand N+O" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs></styleSheet>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const parts = [
  ["[Content_Types].xml", contentTypes],
  ["_rels/.rels", rels],
  ["xl/workbook.xml", workbook],
  ["xl/_rels/workbook.xml.rels", wbRels],
  ["xl/styles.xml", styles],
  ["xl/worksheets/sheet1.xml", sheet],
];

// --- minimaler ZIP-Writer (deflate); kein externes Paket nötig ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const localChunks = [];
const central = [];
let offset = 0;
for (const [name, content] of parts) {
  const nameBuf = Buffer.from(name, "utf8");
  const data = Buffer.from(content, "utf8");
  const comp = deflateRawSync(data);
  const crc = crc32(data);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  localChunks.push(lh, nameBuf, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt32LE(offset, 42);
  central.push(Buffer.concat([ch, nameBuf]));

  offset += lh.length + nameBuf.length + comp.length;
}
const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(parts.length, 8);
eocd.writeUInt16LE(parts.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);

writeFileSync(outFile, Buffer.concat([...localChunks, centralBuf, eocd]));
console.log("xlsx geschrieben: " + outFile);
