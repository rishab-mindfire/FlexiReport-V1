// --------------------------------------------------------------------------------------------------
//generate single line Query for all selected fields
function generateSingleLineQuery(sqlMap) {
  const aliasMap = {};
  const joins = [];
  const fields = [];
  let whereClause = '';
  let contextTable = '';

  // 1. IDENTIFY CONTEXT (t0)
  // Looks for the "Table::Field" pattern in the WHERE strings
  for (const sql of Object.values(sqlMap)) {
    const contextMatch = sql.match(/'"&([^:]+)::/i);
    if (contextMatch) {
      contextTable = contextMatch[1];
      break;
    }
  }

  if (!contextTable) return 'Error: Could not detect FileMaker Table Context.';

  const getAlias = (tbl, lvl) => {
    if (!aliasMap[tbl]) aliasMap[tbl] = `t${lvl}`;
    return aliasMap[tbl];
  };

  const t0 = getAlias(contextTable, 0);

  // 2. PROCESS ENTRIES
  Object.values(sqlMap).forEach((sql) => {
    const fieldName = sql.match(/SELECT\s+\\"([^"]+)\\"/i)?.[1];

    // --- NESTED (LEVEL 2) DETECTION ---
    const nest = sql.match(
      /FROM\s+\\"([^"]+)\\"\s+WHERE\s+\\"([^"]+)\\"\s*=\s*\(\s*SELECT\s+\\"([^"]+)\\"\s+FROM\s+\\"([^"]+)\\"\s+WHERE\s+\\"([^"]+)\\"\s*=\s*'"\&([^:]+)::([^&]+)\&"'/i,
    );

    if (nest) {
      const [_, t2Tbl, t2Fk, t1Pk, t1Tbl, t1Fk, bTbl, bPk] = nest;
      const t1 = getAlias(t1Tbl, 1);
      const t2 = getAlias(t2Tbl, 2);

      if (!joins.find((j) => j.includes(`AS ${t1}`)))
        joins.push(
          `LEFT JOIN \\"${t1Tbl}\\" AS ${t1} ON ${t0}.\\"${bPk}\\" = ${t1}.\\"${t1Fk}\\"`,
        );

      if (!joins.find((j) => j.includes(`AS ${t2}`)))
        joins.push(
          `LEFT JOIN \\"${t2Tbl}\\" AS ${t2} ON ${t2}.\\"${t2Fk}\\" = ${t1}.\\"${t1Pk}\\"`,
        );

      fields.push(`${t2}.\\"${fieldName}\\"`);
      if (!whereClause)
        whereClause = `WHERE ${t0}.\\"${bPk}\\" = '" & ${contextTable}::${bPk} & "'`;
      return;
    }

    // --- DIRECT (LEVEL 1) DETECTION ---
    const direct = sql.match(
      /FROM\s+\\"([^"]+)\\"\s+WHERE\s+\\"([^"]+)\\"\s*=\s*'"\&([^:]+)::([^&]+)\&"'/i,
    );

    if (direct) {
      const [_, t1Tbl, t1Fk, bTbl, bPk] = direct;

      if (t1Tbl === contextTable) {
        // It's actually a Level 0 selection
        fields.push(`${t0}.\\"${fieldName}\\"`);
        if (!whereClause)
          whereClause = `WHERE ${t0}.\\"${t1Fk}\\" = '" & ${contextTable}::${t1Fk} & "'`;
      } else {
        const t1 = getAlias(t1Tbl, 1);
        if (!joins.find((j) => j.includes(`AS ${t1}`)))
          joins.push(
            `LEFT JOIN \\"${t1Tbl}\\" AS ${t1} ON ${t0}.\\"${bPk}\\" = ${t1}.\\"${t1Fk}\\"`,
          );

        fields.push(`${t1}.\\"${fieldName}\\"`);
        if (!whereClause)
          whereClause = `WHERE ${t0}.\\"${bPk}\\" = '" & ${contextTable}::${bPk} & "'`;
      }
    }
  });

  return `SELECT DISTINCT ${fields.join(', ')} FROM \\"${contextTable}\\" AS ${t0} ${joins.join(' ')} ${whereClause}`.trim();
}
window.generateSingleLineQueryForFM = function (sqlObject) {
  const sqlString = generateSingleLineQuery(JSON.parse(sqlObject));
  console.log('Generated SQL String:', sqlString);
  FileMaker.PerformScript('saveSingleStringQuery', sqlString);
};
//----------------------------------------------------------------------------------------------------
//----------------------------------------------------------------------------------------------------

// Global variable to store processed data and layout
let reportData = [];
let currentLayout = {
  grouping: { enabled: false, field: '' },
  parts: {},
};

// --- FUNCTION 1: Receive Data (The Bridge) ---
// Accepts a single JSON object: { columnHeader: [], bodyData: [], schemaJson: {} }
window.receiveFileMakerData = function (jsonParameter) {
  try {
    const payload =
      typeof jsonParameter === 'string'
        ? JSON.parse(jsonParameter)
        : jsonParameter;
    const { columnHeader, bodyData, schemaJson } = payload;

    if (!columnHeader || !bodyData) {
      throw new Error("Missing 'columnHeader' or 'bodyData' in payload.");
    }

    // 1. Update the Layout Schema dynamically
    if (schemaJson) {
      currentLayout =
        typeof schemaJson === 'string' ? JSON.parse(schemaJson) : schemaJson;
    }

    // 2. Map Column Headers to Data Rows
    reportData = parseFileMakerData(columnHeader, bodyData);

    // 3. Generate the PDF
    generatePdf();

    document.getElementById('status').innerText =
      'Data received and PDF generated successfully.';
  } catch (e) {
    console.error('Error processing FileMaker data', e);
    document.getElementById('status').innerText = 'Error: ' + e.message;
  }
};

// --- FUNCTION 2: Process Data ---
function parseFileMakerData(keys, rows) {
  return rows.map((rowString) => {
    const values = rowString.split('^');
    const obj = {};
    keys.forEach((key, index) => {
      let val = values[index] || '';
      // Convert numeric strings to actual numbers for SUM functions
      obj[key] = val !== '' && !isNaN(val) ? parseFloat(val) : val;
    });
    return obj;
  });
}

// --- FUNCTION 3: PDF GENERATION ENGINE ---
async function generatePdf() {
  if (!window.jspdf) return alert('Loading PDF engine...');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'pt', 'a4');
  const pageHeight = doc.internal.pageSize.getHeight();

  let data = [...reportData];
  let cursorY = 0;
  let currentGroup = null;
  let groupTotal = 0;
  let grandTotal = 0;

  // 1. Sort Data if grouping is enabled
  if (currentLayout.grouping.enabled && currentLayout.grouping.field) {
    data.sort((a, b) =>
      String(a[currentLayout.grouping.field]).localeCompare(
        String(b[currentLayout.grouping.field]),
      ),
    );
  }

  function renderPart(partName, rowData, total) {
    const part = currentLayout.parts[partName];
    if (!part) return;

    // Check for page overflow
    if (cursorY + part.height > pageHeight - 40) {
      doc.addPage();
      cursorY = 20;
      if (currentLayout.parts.header) renderPart('header', null, null);
    }

    part.elements.forEach((el) => {
      doc.setFontSize(el.fontSize || 12);
      const fontStyle =
        el.bold && el.italic
          ? 'bolditalic'
          : el.bold
            ? 'bold'
            : el.italic
              ? 'italic'
              : 'normal';
      doc.setFont('helvetica', fontStyle);

      let text = '';
      if (el.type === 'label') {
        text = el.content;
      } else if (el.type === 'field') {
        let key = el.key || el.content.replace(/[\[\]]/g, '');
        text = rowData ? String(rowData[key] ?? '') : '';
      } else if (el.type === 'calculation') {
        text = (total || 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
        });
      }

      const absY = cursorY + el.y + el.fontSize;
      doc.text(text, el.x, absY);
      if (el.underline) {
        const w = doc.getTextWidth(text);
        doc.line(el.x, absY + 2, el.x + w, absY + 2);
      }
    });
    cursorY += part.height;
  }

  // --- Start Rendering ---
  renderPart('header', null, null);

  data.forEach((row) => {
    const groupVal = row[currentLayout.grouping.field];

    if (currentLayout.grouping.enabled && groupVal !== currentGroup) {
      if (currentGroup !== null) renderPart('group-footer', null, groupTotal);
      currentGroup = groupVal;
      groupTotal = 0;
      renderPart('group-header', row, null);
    }

    renderPart('body', row, null);

    // Summing logic (looks for calc field in footer)
    const calcField =
      currentLayout.parts['footer']?.elements.find(
        (e) => e.type === 'calculation',
      )?.field || 'Paid Amount_t';
    const val = parseFloat(row[calcField]) || 0;
    groupTotal += val;
    grandTotal += val;
  });

  if (currentLayout.grouping.enabled && currentGroup !== null)
    renderPart('group-footer', null, groupTotal);
  renderPart('footer', null, grandTotal);

  document.getElementById('preview').src = doc.output('bloburl');
}

// --- BROWSER SIMULATION ---
function simulateFileMakerInput() {
  const dummyPayload = {
    columnHeader: ['Order_id', 'Paid Amount_t', 'District'],
    bodyData: [
      'ORD-1001^5000.00^Lazio',
      'ORD-1002^127750.00^Catalonia',
      'ORD-1003^89700.00^Lazio',
      'ORD-1004^1500.00^Lazio',
    ],
    schemaJson: {
      grouping: { enabled: true, field: 'District' },
      parts: {
        header: {
          height: 60,
          elements: [
            {
              type: 'label',
              content: 'FILEMAKER DYNAMIC REPORT',
              x: 40,
              y: 10,
              fontSize: 18,
              bold: true,
              underline: true,
            },
          ],
        },
        'group-header': {
          height: 30,
          elements: [
            {
              type: 'field',
              key: 'District',
              x: 40,
              y: 5,
              fontSize: 14,
              bold: true,
            },
          ],
        },
        body: {
          height: 25,
          elements: [
            { type: 'field', key: 'Order_id', x: 60, y: 5, fontSize: 11 },
            { type: 'field', key: 'Paid Amount_t', x: 450, y: 5, fontSize: 11 },
          ],
        },
        footer: {
          height: 50,
          elements: [
            {
              type: 'label',
              content: 'GRAND TOTAL',
              x: 350,
              y: 15,
              fontSize: 14,
              bold: true,
            },
            {
              type: 'calculation',
              field: 'Paid Amount_t',
              x: 450,
              y: 15,
              fontSize: 14,
              bold: true,
            },
          ],
        },
      },
    },
  };

  receiveFileMakerData(dummyPayload);
}

//--filemaker----
window.sendFmJSONData = function (jsonString) {
  const jsonTransform = JSON.parse(jsonString);
  receiveFileMakerData(jsonTransform);
  console.log(jsonTransform);
};
