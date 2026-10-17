// Multi-sheet Excel workbook writer (used by the exit pack). Builds on the single-sheet writer in exports.js.
//
// A sheet model: { name, title, subtitle, columns, rows, totals?, cf? }
// A column: { key, label, type: 'text' | 'date' | 'money' | 'int' | 'number', width, formula? }
//   formula: (r) => '=...' where r is the row number in the sheet. Such a column holds a live Excel formula, so the
//   figure keeps updating after download. `row[key]` is stored as the cached value shown before Excel recalculates.
// cf: [{ col: 'status', rules: [['Overdue', 0], ['Due soon', 1], ['OK', 2]] }]  colours the cell text (0 red, 1 amber, 2 green).
import { xml, colName, S, cell, stylesXml, zipStore } from './exports.js';

const enc = new TextEncoder();
const DXFS = '<dxfs count="3"><dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf><dxf><font><b/><color rgb="FF7F6000"/></font><fill><patternFill><bgColor rgb="FFFFEB9C"/></patternFill></fill></dxf><dxf><font><color rgb="FF006100"/></font><fill><patternFill><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf></dxfs>';

export function sheetName(raw, used) {
  const base = String(raw).replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let n = base; let i = 2;
  while (used.has(n.toLowerCase())) { const suffix = ` ${i++}`; n = base.slice(0, 31 - suffix.length) + suffix; }
  used.add(n.toLowerCase());
  return n;
}

function formulaCell(ref, col, row, r) {
  const v = row[col.key];
  const f = xml(col.formula(r).replace(/^=/, ''));
  if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${S.text}" t="str"><f>${f}</f><v></v></c>`;
  if (typeof v === 'number') return `<c r="${ref}" s="${col.type === 'int' ? S.int : S.number}"><f>${f}</f><v>${v}</v></c>`;
  return `<c r="${ref}" s="${S.text}" t="str"><f>${f}</f><v>${xml(v)}</v></c>`;
}

function sheetXml(model) {
  const cols = model.columns; const rows = [];
  const text = (r, c, v, style) => `<c r="${colName(c)}${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  let r = 1;
  rows.push(`<row r="${r}">${text(r, 0, model.title, S.title)}</row>`); r += 1;
  rows.push(`<row r="${r}">${text(r, 0, model.subtitle || '', S.note)}</row>`); r += 1;
  r += 1;
  const headerRow = r;
  rows.push(`<row r="${r}" ht="30" customHeight="1">${cols.map((c, i) => text(r, i, c.label, S.header)).join('')}</row>`); r += 1;
  const first = r;
  for (const row of model.rows) {
    rows.push(`<row r="${r}">${cols.map((c, i) => (c.formula ? formulaCell(`${colName(i)}${r}`, c, row, r) : cell(`${colName(i)}${r}`, row[c.key], c.type, false))).join('')}</row>`);
    r += 1;
  }
  const last = Math.max(first, r - 1);
  let tail = '';
  let prio = 1;
  for (const rule of model.cf || []) {
    const ci = cols.findIndex((c) => c.key === rule.col); if (ci < 0) continue;
    const L = colName(ci);
    tail += `<conditionalFormatting sqref="${L}${first}:${L}${last}">${rule.rules.map(([val, dxf]) => `<cfRule type="cellIs" dxfId="${dxf}" priority="${prio++}" operator="equal"><formula>"${xml(val)}"</formula></cfRule>`).join('')}</conditionalFormatting>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, Math.min(70, (c.width || 14) + 2))}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A${headerRow}:${colName(cols.length - 1)}${last}"/>${tail}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;
}

export function buildWorkbook(sheets) {
  const used = new Set();
  const named = sheets.map((s) => ({ ...s, tab: sheetName(s.name || s.title, used) }));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(`${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: enc.encode(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc.encode(`${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((s, i) => `<sheet name="${xml(s.tab)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: enc.encode(stylesXml().replace('</cellStyles>', `</cellStyles>${DXFS}`)) },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) })),
  ];
  return zipStore(files);
}

// ---- CSV ---------------------------------------------------------------------------------------
// UTF-8 with a byte-order mark (so Excel reads accents correctly), CRLF line ends, every field quoted when needed.
// Text that a spreadsheet could run as a formula (starts with = + - @ tab or return) gets a leading apostrophe.
const NUMERIC = /^[+-]?\d+(\.\d+)?$/;
export function csvField(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function buildCsv(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [cols.map(csvField).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvField(r[c])).join(','));
  const body = enc.encode(lines.join('\r\n') + '\r\n');
  const out = new Uint8Array(3 + body.length); out.set([0xEF, 0xBB, 0xBF]); out.set(body, 3);
  return out;
}
