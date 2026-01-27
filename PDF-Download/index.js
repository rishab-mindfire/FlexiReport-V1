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

  // 1. CHANGE TO LANDSCAPE ('l') to fit wide columns (X > 595)
  // A4 Landscape: 841.89pt width x 595.28pt height
  const doc = new jsPDF('p', 'pt', 'a4');

  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();

  let data = [...reportData];
  let cursorY = 0;
  let currentGroup = null;
  let groupTotal = 0;

  // --- PRE-CALCULATION STEP ---
  // We must calculate Grand Totals BEFORE rendering, 
  // otherwise Header calculations will show 0.00
  const globalTotals = {};
  data.forEach(row => {
    Object.keys(row).forEach(key => {
      const val = parseFloat(row[key]);
      if (!isNaN(val)) {
        globalTotals[key] = (globalTotals[key] || 0) + val;
      }
    });
  });

  // 2. Sort Data if grouping is enabled
  if (currentLayout.grouping.enabled && currentLayout.grouping.field) {
    data.sort((a, b) =>
      String(a[currentLayout.grouping.field]).localeCompare(
        String(b[currentLayout.grouping.field]),
      ),
    );
  }

  function renderPart(partName, rowData, groupSumValue) {
    const part = currentLayout.parts[partName];
    if (!part) return;

    // Auto-Page Break
    if (cursorY + part.height > pageHeight - 40) {
      doc.addPage();
      cursorY = 20;
      if (currentLayout.parts.header) renderPart('header', null, null);
    }

    part.elements.forEach((el) => {
      doc.setFontSize(el.fontSize || 12);
      const fontStyle =
        el.bold && el.italic ? 'bolditalic'
          : el.bold ? 'bold'
            : el.italic ? 'italic'
              : 'normal';
      doc.setFont('helvetica', fontStyle);

      let text = '';

      // --- HANDLE CONTENT TYPES ---
      if (el.type === 'label') {
        text = el.content;
      }
      else if (el.type === 'field') {
        let key = el.key || el.content.replace(/[\[\]]/g, '');
        text = rowData ? String(rowData[key] ?? '') : '';
      }
      else if (el.type === 'calculation') {
        // Handle Header/Footer Sums
        let val = 0;

        if (partName === 'header' || partName === 'footer') {
          // Use Global Pre-calculated Totals for Header/Footer
          val = globalTotals[el.field] || 0;
        } else if (partName === 'group-footer' || partName === 'group-header') {
          // Use the Group Total passed in arguments
          val = groupSumValue || 0;
        }

        text = val.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      }

      // --- RENDER TEXT ---
      // Check X coordinate to ensure it doesn't overflow page
      // (Optional: You could scale down text here if x > pageWidth)

      const absY = cursorY + el.y + el.fontSize;
      doc.text(text, el.x, absY);

      if (el.underline) {
        const w = doc.getTextWidth(text);
        doc.line(el.x, absY + 2, el.x + w, absY + 2);
      }
    });
    cursorY += part.height;
  }

  // --- START RENDERING ---
  renderPart('header', null, null);

  data.forEach((row) => {
    const groupVal = row[currentLayout.grouping.field];

    // Handle Group Breaks
    if (currentLayout.grouping.enabled && groupVal !== currentGroup) {
      if (currentGroup !== null) {
        renderPart('group-footer', null, groupTotal);
      }
      currentGroup = groupVal;
      groupTotal = 0; // Reset group total
      renderPart('group-header', row, null); // Usually doesn't need total
    }

    renderPart('body', row, null);

    // Accumulate Group Total
    // We look for the field used in the group-footer to sum up
    // (Or default to the first numeric field found in schema if needed)
    const calcEl = currentLayout.parts['group-footer']?.elements.find(e => e.type === 'field' || e.type === 'calculation');
    const keyToSum = calcEl?.key || calcEl?.field || 'PaidAmount_n'; // Fallback

    const val = parseFloat(row[keyToSum]) || 0;
    groupTotal += val;
  });

  // Final Group Footer
  if (currentLayout.grouping.enabled && currentGroup !== null) {
    renderPart('group-footer', null, groupTotal);
  }

  // Grand Footer
  // We pass 0 here because the renderPart logic above now uses globalTotals for Footers
  renderPart('footer', null, 0);

  // --- OUTPUT TO IFRAME ---
  const iframe = document.getElementById('preview');
  if (iframe) {
    iframe.style.width = '100%';
    iframe.style.height = '100vh';
    const blobUrl = doc.output('bloburl');
    // Force Fit to Width (FitH) to see the full Landscape page
    iframe.src = blobUrl + '#toolbar=0&view=FitH';
  }
}


// --- BROWSER SIMULATION ---
function simulateFileMakerInput() {
  const dummyPayload = {
    columnHeader: [
      'OrderID_t',
      'PaidAmount_n',
      'DueAmount_n',
      'CustomerName_t',
      'CustomerDistrict_t'
    ],
    bodyData: [
      'ORD-1001^150.00^50.00^John Smith^New York',
      'ORD-1002^200.00^0.00^Jane Doe^New York',
      'ORD-1003^500.00^100.00^Bob Brown^California',
      'ORD-1004^750.00^0.00^Alice Green^California',
      'ORD-1005^100.00^20.00^Charlie White^California'
    ],
    schemaJson: {
      'grouping': {
        'enabled': true,
        'field': 'region'
      },
      'parts': {
        'header': {
          'height': 101,
          'elements': [
            {
              'type': 'calculation',
              'key': null,
              'content': '[]',
              'x': 295,
              'y': 45,
              'w': 150,
              'h': 25,
              'function': 'SUM',
              'field': 'DueAmount_n',
              'fontSize': 16,
              'bold': true,
              'italic': false,
              'underline': false
            }
          ]
        },
        'group-header': {
          'height': 41,
          'elements': [
            {
              'type': 'field',
              'key': 'region',
              'content': '[region]',
              'x': 21,
              'y': 4,
              'w': 150,
              'h': 25,
              'function': null,
              'field': null,
              'fontSize': 14,
              'bold': true,
              'italic': false,
              'underline': false
            }
          ]
        },
        'body': {
          'height': 61,
          'elements': [
            {
              'type': 'field',
              'key': 'region',
              'content': '[region]',
              'x': 5,
              'y': 13,
              'w': 150,
              'h': 25,
              'function': null,
              'field': null,
              'fontSize': 14,
              'bold': false,
              'italic': false,
              'underline': false
            },
            {
              'type': 'field',
              'key': 'OrderID_t',
              'content': '[OrderID_t]',
              'x': 523,
              'y': 13,
              'w': 65,
              'h': 20,
              'function': null,
              'field': null,
              'fontSize': 14,
              'bold': false,
              'italic': false,
              'underline': false
            },
            {
              'type': 'field',
              'key': 'DueAmount_n',
              'content': '[DueAmount_n]',
              'x': 239,
              'y': 14,
              'w': 150,
              'h': 25,
              'function': null,
              'field': null,
              'fontSize': 14,
              'bold': false,
              'italic': false,
              'underline': false
            }
          ]
        },
        'group-footer': {
          'height': 42,
          'elements': [
            {
              'type': 'calculation',
              'key': null,
              'content': '[]',
              'x': 238,
              'y': 4,
              'w': 150,
              'h': 25,
              'function': 'SUM',
              'field': 'DueAmount_n',
              'fontSize': 14,
              'bold': true,
              'italic': false,
              'underline': false
            }
          ]
        },
        'footer': {
          'height': 61,
          'elements': []
        }
      }
    }
  };

  receiveFileMakerData(dummyPayload);
}

//--filemaker----
window.sendFmJSONData = function (jsonString) {
  const jsonTransform = JSON.parse(jsonString);
  receiveFileMakerData(jsonTransform);
  console.log(jsonTransform);
};
