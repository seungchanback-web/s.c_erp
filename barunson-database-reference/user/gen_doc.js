const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
        ShadingType, PageNumber, PageBreak, LevelFormat, TableOfContents } = require("docx");

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text: String(text), font: "Arial", size: 20, bold: opts.bold, color: opts.color })] })]
  });
}

function heading(text, level) {
  return new Paragraph({ heading: level, children: [new TextRun({ text, font: "Arial", bold: true })] });
}

function para(text, opts = {}) {
  return new Paragraph({ spacing: { after: opts.after || 100 }, children: [new TextRun({ text, font: "Arial", size: opts.size || 20, color: opts.color, bold: opts.bold })] });
}

function infoTable(rows, c1 = 2200, c2 = 7160) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: [c1, c2],
    rows: rows.map(([l, v]) => new TableRow({ children: [cell(l, c1, { bold: true, shading: "F0F4F8" }), cell(v, c2)] }))
  });
}

function colorTable(headers, rows, widths, headerColor) {
  const hdr = new TableRow({ children: headers.map((h, i) => cell(h, widths[i], { bold: true, shading: headerColor, color: "FFFFFF" })) });
  const bodyRows = rows.map(row => new TableRow({ children: row.map((c, i) => cell(c, widths[i], i === 0 ? { bold: true } : {})) }));
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: widths, rows: [hdr, ...bodyRows] });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 36, bold: true, font: "Arial", color: "1F2937" }, paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, font: "Arial", color: "374151" }, paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, font: "Arial", color: "4B5563" }, paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ]
  },
  sections: [
    // 표지
    { properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        new Paragraph({ spacing: { before: 3000 } }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "BARUNCOMPANY", font: "Arial", size: 56, bold: true, color: "2563EB" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: "\uC7AC\uACE0\uC6B4\uC601 \uC2DC\uC2A4\uD15C", font: "Arial", size: 44, color: "374151" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: "\uC124\uACC4\uC11C \uBC0F \uC0AC\uC6A9\uC124\uBA85\uC11C", font: "Arial", size: 28, color: "6B7280" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 }, children: [new TextRun({ text: "v2.0 | 2026.03.18", font: "Arial", size: 22, color: "9CA3AF" })] }),
        new Paragraph({ children: [new PageBreak()] }),
    ]},
    // 본문
    { properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "\uBC14\uB978\uCEF4\uD37C\uB2C8 \uC7AC\uACE0\uC6B4\uC601 \uC2DC\uC2A4\uD15C \uC124\uACC4\uC11C", font: "Arial", size: 16, color: "9CA3AF" })] })] }),},
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Page ", size: 16, color: "9CA3AF" }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "9CA3AF" })] })] }),},
      },
      children: [
        heading("1. \uC2DC\uC2A4\uD15C \uAC1C\uC694", HeadingLevel.HEADING_1),
        para("\uBC14\uB978\uCEF4\uD37C\uB2C8 \uC7AC\uACE0\uC6B4\uC601 \uC2DC\uC2A4\uD15C\uC740 \uCCAD\uCCA9\uC7A5/\uCE74\uB4DC\uB958 \uC81C\uD488\uC758 \uC7AC\uACE0 \uAD00\uB9AC, \uBC1C\uC8FC, \uC785\uACE0, \uCD9C\uACE0\uB97C \uD1B5\uD569 \uAD00\uB9AC\uD558\uB294 \uC6F9 \uAE30\uBC18 \uC2DC\uC2A4\uD15C\uC785\uB2C8\uB2E4."),
        para("XERP ERP \uC2DC\uC2A4\uD15C\uACFC \uC2E4\uC2DC\uAC04 \uC5F0\uB3D9\uD558\uC5EC \uC815\uD655\uD55C \uC7AC\uACE0 \uB370\uC774\uD130\uB97C \uAE30\uBC18\uC73C\uB85C \uD488\uC808 \uBC29\uC9C0 \uBC1C\uC8FC\uB97C \uC790\uB3D9\uD654\uD569\uB2C8\uB2E4.", { after: 200 }),

        heading("1.1 \uC2DC\uC2A4\uD15C \uC815\uBCF4", HeadingLevel.HEADING_2),
        infoTable([
          ["\uC2DC\uC2A4\uD15C\uBA85", "\uBC14\uB978\uCEF4\uD37C\uB2C8 \uC7AC\uACE0\uC6B4\uC601 \uC2DC\uC2A4\uD15C"],
          ["\uBC84\uC804", "v2.0 (2026.03)"],
          ["\uC811\uC18D URL", "http://192.168.200.74:12026"],
          ["\uC11C\uBC84", "Node.js (port 12026)"],
          ["\uB370\uC774\uD130\uBCA0\uC774\uC2A4", "SQLite (orders.db) + MSSQL (XERP)"],
          ["ERP \uC5F0\uB3D9", "XERP (Azure SQL) \uC2E4\uC2DC\uAC04 \uC7AC\uACE0/\uCD9C\uACE0 \uC870\uD68C"],
          ["\uC678\uBD80 \uC5F0\uB3D9", "Google Sheets + Gmail (Apps Script)"],
        ]),

        heading("1.2 \uAE30\uC220 \uC2A4\uD0DD", HeadingLevel.HEADING_2),
        infoTable([
          ["Frontend", "Single HTML (app.html) + Vanilla JS + CSS"],
          ["Backend", "Node.js HTTP Server (serve_inv2.js)"],
          ["Local DB", "SQLite (better-sqlite3)"],
          ["ERP DB", "MSSQL (mssql) - XERP"],
          ["Email", "Gmail API via Apps Script"],
          ["Sheet", "Google Apps Script (clasp)"],
        ]),

        new Paragraph({ children: [new PageBreak()] }),

        // 2. 메뉴 구조
        heading("2. \uBA54\uB274 \uAD6C\uC870", HeadingLevel.HEADING_1),
        para("\uC0AC\uC774\uB4DC\uBC14\uB294 4\uAC1C \uADF8\uB8F9\uC73C\uB85C \uAD6C\uBD84: \uC7AC\uACE0 / \uBC1C\uC8FC / \uC785\uACE0 / \uAD00\uB9AC", { after: 200 }),
        colorTable(
          ["\uBA54\uB274", "\uC124\uBA85", "\uB370\uC774\uD130 \uC18C\uC2A4"],
          [
            ["\uD648", "\uB300\uC2DC\uBCF4\uB4DC - \uAE34\uAE09/\uC704\uD5D8\uC7AC\uACE0, \uBC1C\uC8FC \uD30C\uC774\uD504\uB77C\uC778", "SQLite"],
            ["\uC7AC\uACE0\uD604\uD669", "ERP \uC2E4\uC2DC\uAC04 \uC7AC\uACE0 + \uD488\uC808 \uBC29\uC9C0 \uBC1C\uC8FC", "XERP mmInventory"],
            ["\uCD9C\uACE0\uD604\uD669", "\uCD9C\uACE0\uC644\uB8CC/\uCD9C\uACE0\uC608\uC815 (1\uAC1C\uC6D4)", "XERP mmInoutItem"],
            ["\uD544\uC218 \uC790\uB3D9\uBC1C\uC8FC", "\uCD5C\uC18C\uC7AC\uACE0 \uC774\uD558 \uC2DC \uC790\uB3D9 PO", "SQLite"],
            ["\uBC1C\uC8FC\uC0DD\uC131", "\uC7AC\uACE0\uD604\uD669 \uC120\uD0DD \uD488\uBAA9 -> PO", "SQLite"],
            ["\uBC1C\uC8FC\uD604\uD669", "\uC804\uCCB4 PO \uBAA9\uB85D + \uC0C1\uD0DC \uAD00\uB9AC", "SQLite"],
            ["OS\uB4F1\uB85D", "XERP OS\uBC88\uD638 \uC790\uB3D9 \uB9E4\uCE6D", "XERP poOrderItem"],
            ["\uC785\uACE0\uC77C\uC815", "\uCE98\uB9B0\uB354 - \uD655\uC815\uC77C/\uC608\uC0C1\uC77C \uAD6C\uBD84", "SQLite"],
            ["\uC785\uACE0\uAD00\uB9AC", "PO \uAE30\uBC18 \uC218\uB839 \uB4F1\uB85D", "SQLite"],
            ["\uAC70\uB798\uBA85\uC138\uC11C", "\uAC70\uB798\uCC98\uBCC4 \uBA85\uC138\uC11C", "SQLite"],
            ["\uAC70\uB798\uCC98 \uAD00\uB9AC", "\uC6D0\uC7AC\uB8CC/\uD6C4\uACF5\uC815 \uAC70\uB798\uCC98", "SQLite"],
            ["\uD488\uBAA9\uAD00\uB9AC", "\uD55C\uAD6D/\uC911\uAD6D/\uB354\uAE30\uD504\uD2B8 + \uC5D1\uC140 \uC5C5\uB85C\uB4DC", "SQLite"],
            ["\uC124\uC815", "\uBC1C\uC8FC \uAC00\uC774\uB4DC \uC124\uC815", "localStorage"],
          ],
          [1800, 4560, 3000], "2563EB"
        ),

        new Paragraph({ children: [new PageBreak()] }),

        // 3. 핵심 기능
        heading("3. \uD575\uC2EC \uAE30\uB2A5 \uC0C1\uC138", HeadingLevel.HEADING_1),

        heading("3.1 \uC7AC\uACE0\uD604\uD669 (\uD488\uC808 \uBC29\uC9C0 \uBC1C\uC8FC \uC124\uACC4)", HeadingLevel.HEADING_2),
        para("XERP ERP\uC5D0\uC11C \uC2E4\uC2DC\uAC04 \uC7AC\uACE0\uC640 \uCD9C\uACE0 \uB370\uC774\uD130\uB97C \uC870\uD68C\uD558\uC5EC \uD488\uC808 \uC704\uD5D8\uC744 \uC790\uB3D9 \uAC10\uC9C0\uD569\uB2C8\uB2E4."),
        para(""),
        para("\uBC1C\uC8FC \uD2B8\uB9AC\uAC70 \uACF5\uC2DD:", { bold: true, size: 22 }),
        para("  \uC6D4\uD3C9\uADE0\uCD9C\uACE0 = XERP \uCD5C\uADFC 3\uAC1C\uC6D4 \uCD9C\uACE0\uD569\uACC4 / 3"),
        para("  \uC548\uC804\uC7AC\uACE0 = \uC6D4\uD3C9\uADE0\uCD9C\uACE0 x 1\uAC1C\uC6D4"),
        para("  \uB9AC\uB4DC\uD0C0\uC784\uC7AC\uACE0 = \uC6D4\uD3C9\uADE0\uCD9C\uACE0 x (\uB9AC\uB4DC\uD0C0\uC784\uC77C\uC218 / 30)"),
        para("  \uBC1C\uC8FC\uC810 = \uC548\uC804\uC7AC\uACE0 + \uB9AC\uB4DC\uD0C0\uC784\uC7AC\uACE0"),
        para("  \uBC1C\uC8FC\uD544\uC694 = \uAC00\uC6A9\uC7AC\uACE0 < \uBC1C\uC8FC\uC810", { bold: true, color: "DC2626" }),
        para(""),
        para("\uBC1C\uC8FC\uC218\uB7C9:", { bold: true, size: 22 }),
        para("  \uBAA9\uD45C\uC7AC\uACE0 = \uC548\uC804\uC7AC\uACE0 + \uB9AC\uB4DC\uD0C0\uC784\uC7AC\uACE0 + (\uC6D4\uD3C9\uADE0 x \uBC1C\uC8FC\uAE30\uAC04)"),
        para("  \uBC1C\uC8FC\uC218\uB7C9 = MAX(\uC62C\uB9BC(\uBAA9\uD45C-\uAC00\uC6A9, 10,000), 10,000)", { bold: true }),
        para(""),
        colorTable(
          ["\uC0C1\uD0DC", "\uC870\uAC74", "\uC758\uBBF8"],
          [
            ["\uAE34\uAE09", "\uAC00\uC6A9\uC7AC\uACE0 <= 0", "\uC774\uBBF8 \uD488\uC808"],
            ["\uC704\uD5D8", "\uAC00\uC6A9\uC7AC\uACE0 < \uBC1C\uC8FC\uC810", "\uB9AC\uB4DC\uD0C0\uC784 \uB0B4 \uD488\uC808 \uC704\uD5D8"],
            ["\uC548\uC804", "\uAC00\uC6A9\uC7AC\uACE0 >= \uBC1C\uC8FC\uC810", "\uCDA9\uBD84"],
            ["\uB9E4\uCD9C\uC5C6\uC74C", "3\uAC1C\uC6D4 \uCD9C\uACE0 0", "\uCD9C\uACE0 \uC5C6\uC74C"],
          ],
          [1800, 4000, 3560], "EF4444"
        ),

        heading("3.2 \uBC1C\uC8FC \uD504\uB85C\uC138\uC2A4", HeadingLevel.HEADING_2),
        para("\uBC1C\uC8FC \uC0C1\uD0DC \uD750\uB984:", { bold: true }),
        para("  \uB300\uAE30 -> \uBC1C\uC1A1(\uC774\uBA54\uC77C+PDF) -> \uD655\uC778 -> OS\uB4F1\uB85D\uB300\uAE30 -> \uC644\uB8CC"),
        para(""),
        para("\uBC1C\uC8FC\uD655\uC778(\uBC1C\uC1A1) \uC2DC:", { bold: true }),
        para("  1. \uAC70\uB798\uCC98 \uC774\uBA54\uC77C\uB85C \uBC1C\uC8FC\uC11C PDF \uCCA8\uBD80 \uBC1C\uC1A1"),
        para("  2. Google Sheets\uC5D0 \uBC1C\uC8FC \uB370\uC774\uD130 \uB3D9\uAE30\uD654"),
        para("  3. \uC6D0\uC7AC\uB8CC \uBC1C\uC1A1 \uC644\uB8CC -> \uD6C4\uACF5\uC815 \uC5C5\uCCB4\uC5D0 \uC790\uB3D9 \uC774\uBA54\uC77C"),

        heading("3.3 OS\uB4F1\uB85D (XERP \uC5F0\uB3D9)", HeadingLevel.HEADING_2),
        para("XERP poOrderItem\uC5D0\uC11C \uC81C\uD488\uCF54\uB4DC\uB85C OS\uBC88\uD638\uB97C \uC790\uB3D9 \uB9E4\uCE6D\uD569\uB2C8\uB2E4."),
        colorTable(
          ["\uD0ED", "\uC124\uBA85"],
          [
            ["\uB300\uAE30", "OS \uBBF8\uB4F1\uB85D PO - \uC218\uB3D9 \uC785\uB825 + \uCDE8\uC18C \uAC00\uB2A5"],
            ["\uB9E4\uCE6D\uC644\uB8CC", "XERP \uC790\uB3D9 \uB9E4\uCE6D\uB41C PO - \uD655\uC778 \uD6C4 \uC644\uB8CC\uCC98\uB9AC"],
            ["\uC644\uB8CC", "OS\uBC88\uD638 \uB4F1\uB85D \uC644\uB8CC\uB41C PO"],
            ["\uCDE8\uC18C", "\uCDE8\uC18C\uB41C PO"],
          ],
          [2000, 7360], "7C3AED"
        ),

        heading("3.4 \uC785\uACE0\uC77C\uC815 (\uCE98\uB9B0\uB354)", HeadingLevel.HEADING_2),
        colorTable(
          ["\uAD6C\uBD84", "\uC0C9\uC0C1", "\uC758\uBBF8"],
          [
            ["\uCD08\uB85D \uBC30\uACBD", "\uC88C\uCE21 \uCD08\uB85D \uBC14", "\uAC70\uB798\uCC98 \uD655\uC815\uC77C (expected_date)"],
            ["\uC8FC\uD669 \uBC30\uACBD", "\uC88C\uCE21 \uC8FC\uD669 \uBC14", "\uB9AC\uB4DC\uD0C0\uC784 \uAE30\uBC18 \uC608\uC0C1\uC77C (\uC6D0\uC7AC\uB8CC 5\uC77C, \uD6C4\uACF5\uC815 7\uC77C)"],
            ["\uD68C\uC0C9 \uCDE8\uC18C\uC120", "\uD68C\uC0C9 \uBC30\uACBD", "\uC785\uACE0 \uC644\uB8CC"],
          ],
          [2000, 2500, 4860], "059669"
        ),

        new Paragraph({ children: [new PageBreak()] }),

        // 4. API
        heading("4. API \uBA85\uC138", HeadingLevel.HEADING_1),
        heading("4.1 XERP \uC5F0\uB3D9", HeadingLevel.HEADING_2),
        colorTable(
          ["Method", "Endpoint", "\uC124\uBA85"],
          [
            ["GET", "/api/xerp-inventory", "\uC2E4\uC2DC\uAC04 \uC7AC\uACE0 + \uC6D4\uCD9C\uACE0 \uD1B5\uD569 (10\uBD84 \uCE90\uC2DC)"],
            ["GET", "/api/xerp-monthly-usage", "\uD488\uBAA9\uBCC4 3\uAC1C\uC6D4 \uCD9C\uACE0\uB7C9 (1\uC2DC\uAC04 \uCE90\uC2DC)"],
            ["GET", "/api/shipments", "\uCD9C\uACE0\uD604\uD669 (\uC804\uD6C4 1\uAC1C\uC6D4)"],
            ["GET", "/api/po/os-match", "XERP OS\uBC88\uD638 \uC790\uB3D9 \uB9E4\uCE6D"],
          ],
          [1200, 3660, 4500], "059669"
        ),
        heading("4.2 \uBC1C\uC8FC \uAD00\uB9AC", HeadingLevel.HEADING_2),
        colorTable(
          ["Method", "Endpoint", "\uC124\uBA85"],
          [
            ["GET", "/api/po", "PO \uBAA9\uB85D (?include=items)"],
            ["POST", "/api/po", "PO \uC0DD\uC131"],
            ["PATCH", "/api/po/:id", "\uC0C1\uD0DC \uBCC0\uACBD + \uC774\uBA54\uC77C/\uC2DC\uD2B8"],
            ["PATCH", "/api/po/:id/os", "OS\uBC88\uD638 \uB4F1\uB85D -> \uC644\uB8CC"],
            ["DELETE", "/api/po/:id", "draft PO \uC0AD\uC81C"],
            ["GET", "/api/po/stats", "\uB300\uC2DC\uBCF4\uB4DC \uD1B5\uACC4"],
          ],
          [1200, 3660, 4500], "2563EB"
        ),
        heading("4.3 \uB9C8\uC2A4\uD130 \uB370\uC774\uD130", HeadingLevel.HEADING_2),
        colorTable(
          ["Method", "Endpoint", "\uC124\uBA85"],
          [
            ["GET", "/api/vendors", "\uAC70\uB798\uCC98 \uBAA9\uB85D"],
            ["POST", "/api/vendors", "\uAC70\uB798\uCC98 \uB4F1\uB85D"],
            ["GET", "/api/products", "\uD488\uBAA9 \uBAA9\uB85D"],
            ["POST", "/api/products/bulk", "\uD488\uBAA9 \uC5D1\uC140 \uC77C\uAD04 \uC5C5\uB85C\uB4DC"],
            ["POST", "/api/auto-order/check", "\uC790\uB3D9\uBC1C\uC8FC \uC2E4\uD589"],
          ],
          [1200, 3660, 4500], "7C3AED"
        ),

        new Paragraph({ children: [new PageBreak()] }),

        // 5. DB
        heading("5. \uB370\uC774\uD130\uBCA0\uC774\uC2A4", HeadingLevel.HEADING_1),
        heading("5.1 SQLite (orders.db) - 17\uAC1C \uD14C\uC774\uBE14", HeadingLevel.HEADING_2),
        colorTable(
          ["\uD14C\uC774\uBE14", "\uC124\uBA85", "\uC8FC\uC694 \uCEEC\uB7FC"],
          [
            ["po_header", "\uBC1C\uC8FC \uD5E4\uB354", "po_id, status, os_number"],
            ["po_items", "\uBC1C\uC8FC \uD488\uBAA9", "product_code, ordered_qty"],
            ["vendors", "\uAC70\uB798\uCC98 \uB9C8\uC2A4\uD130", "vendor_code, email, type"],
            ["products", "\uD488\uBAA9 \uB9C8\uC2A4\uD130", "product_code, origin"],
            ["auto_order_items", "\uD544\uC218 \uC790\uB3D9\uBC1C\uC8FC", "min_stock, order_qty"],
            ["receipts", "\uC785\uACE0 \uD5E4\uB354", "po_id, receipt_date"],
            ["invoices", "\uAC70\uB798\uBA85\uC138\uC11C", "vendor_id"],
            ["bom_header", "BOM", "product_code"],
            ["order_history", "\uBC1C\uC8FC \uC774\uB825", "product_code"],
          ],
          [2500, 4000, 2860], "1F2937"
        ),
        heading("5.2 XERP (Azure SQL) - \uC77D\uAE30 \uC804\uC6A9", HeadingLevel.HEADING_2),
        colorTable(
          ["\uD14C\uC774\uBE14", "\uC124\uBA85", "\uC8FC\uC694 \uCEEC\uB7FC"],
          [
            ["mmInventory", "\uD604\uC7AC\uACE0 (\uCC3D\uACE0\uBCC4)", "ItemCode, OhQty"],
            ["mmInoutItem", "\uC785\uCD9C\uACE0 \uC0C1\uC138 (4\uCC9C\uB9CC\uAC74)", "ItemCode, InoutQty"],
            ["poOrderHeader", "\uAD6C\uB9E4\uC8FC\uBB38 (OS\uBC88\uD638)", "OrderNo, CsCode"],
            ["poOrderItem", "\uAD6C\uB9E4\uC8FC\uBB38 \uD488\uBAA9", "ItemCode, OrderQty"],
          ],
          [2500, 4000, 2860], "DC2626"
        ),

        new Paragraph({ children: [new PageBreak()] }),

        // 6. 설정
        heading("6. \uC124\uC815 \uAC00\uC774\uB4DC", HeadingLevel.HEADING_1),
        heading("6.1 \uBC1C\uC8FC \uC124\uC815", HeadingLevel.HEADING_2),
        infoTable([
          ["\uB9E4\uCD9C \uAE30\uC900\uAE30\uAC04", "3\uAC1C\uC6D4 (XERP \uCD9C\uACE0 \uC2E4\uC801)"],
          ["\uBC1C\uC8FC \uAE30\uAC04", "1\uAC1C\uC6D4\uBD84"],
          ["\uC62C\uB9BC \uB2E8\uC704", "10,000\uAC1C"],
          ["\uCD5C\uC18C \uBC1C\uC8FC\uC218\uB7C9", "10,000\uAC1C"],
          ["\uB9AC\uB4DC\uD0C0\uC784 (\uC6D0\uC7AC\uB8CC)", "5\uC601\uC5C5\uC77C"],
          ["\uB9AC\uB4DC\uD0C0\uC784 (\uD6C4\uACF5\uC815)", "7\uC601\uC5C5\uC77C"],
          ["\uC548\uC804\uC7AC\uACE0", "1\uAC1C\uC6D4\uBD84"],
        ]),

        heading("6.2 \uC11C\uBC84 \uC2E4\uD589", HeadingLevel.HEADING_2),
        para("cd C:\\barunson\\barunson-database-reference\\user", { bold: true }),
        para("node serve_inv2.js", { bold: true }),
        para(""),
        para("\uC811\uC18D: http://192.168.200.74:12026", { bold: true, color: "2563EB" }),

        heading("6.3 Google Sheets \uD1A0\uD070 \uAC31\uC2E0", HeadingLevel.HEADING_2),
        para("\uD1A0\uD070 \uB9CC\uB8CC \uC2DC: clasp login -> \uBE0C\uB77C\uC6B0\uC800 \uB85C\uADF8\uC778 -> \uC11C\uBC84 \uC7AC\uC2DC\uC791"),

        new Paragraph({ spacing: { before: 800 } }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "- END -", font: "Arial", size: 24, color: "9CA3AF", italics: true })] }),
      ]
    }
  ]
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = "C:\\barunson\\barunson-database-reference\\user\\\uBC14\uB978\uCEF4\uD37C\uB2C8_\uC7AC\uACE0\uC6B4\uC601\uC2DC\uC2A4\uD15C_\uC124\uACC4\uC11C.docx";
  fs.writeFileSync(outPath, buffer);
  console.log("Generated:", outPath, "(" + Math.round(buffer.length/1024) + "KB)");
});
