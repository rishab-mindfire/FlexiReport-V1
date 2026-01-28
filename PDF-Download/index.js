// --------------------------------------------------------------------------------------------------
// --------------------------------------------------------------------------------------------------
//generate single line Query for all selected fields
function generateSingleLineQuery(sqlMap) {
  const aliasMap = {};
  const joins = [];
  const fields = [];
  let whereClause = '';
  let contextTable = '';
  let basePrimaryKey = '';

  // 1️⃣ Identify context table (t0)
  for (const sql of Object.values(sqlMap)) {
    const contextMatch = sql.match(/'"&([^:]+)::/i);
    if (contextMatch) {
      contextTable = contextMatch[1];
      break;
    }
  }

  if (!contextTable) {
    console.error('Context table not found');
    return null;
  }

  const getAlias = (tbl, lvl) => {
    if (!aliasMap[tbl]) aliasMap[tbl] = `t${lvl}`;
    return aliasMap[tbl];
  };

  const t0 = getAlias(contextTable, 0);

  // 2️⃣ Process each SQL entry
  Object.values(sqlMap).forEach((sql) => {
    const fieldName = sql.match(/SELECT\s+\\"([^"]+)\\"/i)?.[1];
    if (!fieldName) return;

    // --- Nested query detection ---
    const nest = sql.match(
      /FROM\s+\\"([^"]+)\\"\s+WHERE\s+\\"([^"]+)\\"\s*=\s*\(\s*SELECT\s+\\"([^"]+)\\"\s+FROM\s+\\"([^"]+)\\"\s+WHERE\s+\\"([^"]+)\\"\s*=\s*'"\&([^:]+)::([^&]+)\&"'/i,
    );

    if (nest) {
      const [_, t2Tbl, t2Fk, t1Pk, t1Tbl, t1Fk, bTbl, bPk] = nest;
      if (!basePrimaryKey && t1Tbl === contextTable) basePrimaryKey = bPk;

      const t1 = getAlias(t1Tbl, 1);
      const t2 = getAlias(t2Tbl, 2);

      if (!joins.find((j) => j.includes(`AS ${t1}`))) {
        joins.push(
          `LEFT JOIN \\"${t1Tbl}\\" AS ${t1} ON ${t0}.\\"${bPk}\\" = ${t1}.\\"${t1Fk}\\"`,
        );
      }
      if (!joins.find((j) => j.includes(`AS ${t2}`))) {
        joins.push(
          `LEFT JOIN \\"${t2Tbl}\\" AS ${t2} ON ${t2}.\\"${t2Fk}\\" = ${t1}.\\"${t1Pk}\\"`,
        );
      }

      fields.push(`${t2}.\\"${fieldName}\\"`);
      return;
    }

    // --- Direct query detection ---
    const direct = sql.match(
      /FROM\s+\\"([^"]+)\\"\s+WHERE\s+\\"([^"]+)\\"\s*=\s*'"\&([^:]+)::([^&]+)\&"'/i,
    );

    if (direct) {
      const [_, t1Tbl, t1Fk, bTbl, bPk] = direct;

      // Only assign basePrimaryKey if it's the context table
      if (!basePrimaryKey && t1Tbl === contextTable) basePrimaryKey = bPk;

      if (t1Tbl === contextTable) {
        fields.push(`${t0}.\\"${fieldName}\\"`);
      } else {
        const t1 = getAlias(t1Tbl, 1);
        if (!joins.find((j) => j.includes(`AS ${t1}`))) {
          joins.push(
            `LEFT JOIN \\"${t1Tbl}\\" AS ${t1} ON ${t0}.\\"${bPk}\\" = ${t1}.\\"${t1Fk}\\"`,
          );
        }
        fields.push(`${t1}.\\"${fieldName}\\"`);
      }
    }
  });

  // 3️⃣ Build WHERE clause using correct primary key
  if (!basePrimaryKey) {
    console.error('Could not detect primary key for context table');
    return null;
  }

  whereClause = `WHERE ${t0}.\\"${basePrimaryKey}\\" = ?`;

  // 4️⃣ Return FileMaker-ready object
  return {
    sqlString:
      `SELECT DISTINCT ${fields.join(', ')} FROM \\"${contextTable}\\" AS ${t0} ${joins.join(' ')} ${whereClause}`.trim(),
    sqlParameter: `${contextTable}::${basePrimaryKey}`,
  };
}

window.generateSingleLineQueryForFM = function (sqlMap) {
  const sqlSingleLineQuery = generateSingleLineQuery(JSON.parse(sqlMap));

  console.log('Generated SQL Object:', sqlSingleLineQuery);

  FileMaker.PerformScript(
    'saveSingleStringQuery',
    JSON.stringify(sqlSingleLineQuery),
  );
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
// --- FUNCTION 3: PDF GENERATION ENGINE (DYNAMIC CALCS) ---
async function generatePdf() {
  if (!window.jspdf) return alert('Loading PDF engine...');
  const { jsPDF } = window.jspdf;

  // 1. Setup PDF
  const doc = new jsPDF('p', 'pt', 'a4');
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();

  let data = [...reportData];
  let cursorY = 0;

  // Grouping Variables
  let currentGroup = null;
  // This object will hold dynamic sums for the current group: { "PaidAmount_n": 100, "DueAmount_n": 50 }
  let currentGroupTotals = {};

  // --- PRE-CALCULATION (GRAND TOTALS) ---
  // We calculate totals for EVERY field in the dataset upfront.
  // This allows the Header (which prints first) to know the Grand Totals.
  const globalTotals = {};

  data.forEach((row) => {
    Object.keys(row).forEach((key) => {
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

  // --- RENDER FUNCTION ---
  // @param aggregates: An object containing sums (either globalTotals or currentGroupTotals)
  function renderPart(partName, rowData, aggregates) {
    const part = currentLayout.parts[partName];
    if (!part) return;

    // --- AUTO-PAGE BREAK ---
    if (cursorY + part.height > pageHeight - 40) {
      doc.addPage();
      cursorY = 20;
      // Note: We do NOT re-render the 'header' here, per your previous request.
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

      // --- DYNAMIC CONTENT HANDLING ---
      if (el.type === 'label') {
        text = el.content;
      } else if (el.type === 'field') {
        // Standard Field from Row Data
        let key = el.key || el.content.replace(/[\[\]]/g, '');
        text = rowData ? String(rowData[key] ?? '') : '';
      } else if (el.type === 'calculation') {
        // --- DYNAMIC CALCULATION ---
        // 1. We look at the JSON Schema to see WHICH field this element wants (el.field)
        // 2. We look at the passed 'aggregates' object to find that value.
        // 3. This works for ANY field, without hardcoding names in JavaScript.

        const fieldName = el.field; // e.g., "DueAmount_n" or "PaidAmount_n"
        const val =
          aggregates && aggregates[fieldName] ? aggregates[fieldName] : 0;

        text = val.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      }

      // --- DRAW TEXT ---
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

  // 1. Header: Render once. Pass 'globalTotals' so it can display Grand Totals if requested.
  renderPart('header', null, globalTotals);

  // 2. Body Loop
  data.forEach((row) => {
    const groupVal = row[currentLayout.grouping.field];

    // --- CHECK FOR GROUP CHANGE ---
    if (currentLayout.grouping.enabled && groupVal !== currentGroup) {
      // If closing a previous group, print its footer
      if (currentGroup !== null) {
        renderPart('group-footer', null, currentGroupTotals);
      }

      // Reset Group
      currentGroup = groupVal;
      currentGroupTotals = {}; // Clear totals for the new group

      // Print new Group Header
      renderPart('group-header', row, null);
    }

    // Print Body Row
    renderPart('body', row, null);

    // --- ACCUMULATE GROUP TOTALS DYNAMICALLY ---
    // Iterate over every field in the current row.
    // If it's a number, add it to the running total for that field in this group.
    Object.keys(row).forEach((key) => {
      const val = parseFloat(row[key]);
      if (!isNaN(val)) {
        currentGroupTotals[key] = (currentGroupTotals[key] || 0) + val;
      }
    });
  });

  // 3. Final Group Footer
  if (currentLayout.grouping.enabled && currentGroup !== null) {
    renderPart('group-footer', null, currentGroupTotals);
  }

  // 4. Footer: Render once. Pass 'globalTotals'.
  renderPart('footer', null, globalTotals);

  // --- OUTPUT ---
  const iframe = document.getElementById('preview');
  if (iframe) {
    iframe.style.width = '100%';
    iframe.style.height = '100vh';
    const blobUrl = doc.output('bloburl');
    iframe.src = blobUrl + '#toolbar=0&view=FitH';
  }
}

// --- BROWSER SIMULATION ---
function simulateFileMakerInput() {
  const dummyPayload = {
    columnHeader: [
      'CustomerDistrict_t',
      'CustomerName_t',
      'DueAmount_n',
      'OrderID_t',
      'PaidAmount_n',
    ],
    bodyData: [
      // --- California ---
      'California^Cyberdyne Systems^0^ORD-9001^15500',
      'California^Cyberdyne Systems^2500^ORD-9002^5000',
      'California^Silicon Valley Traders^12000^ORD-9003^42000',
      'California^Silicon Valley Traders^0^ORD-9004^11500',
      'California^Bay Area Logistics^500^ORD-9005^3200',
      'California^Bay Area Logistics^0^ORD-9006^8900',
      'California^Sarah Connor^150^ORD-9007^450',
      'California^Mick^0^ORD-9008^201500',
      'California^Mick^331500^ORD-9009^3000',

      // --- New South Wales ---

      'New South Wales^Skeletor Inc^5000^ORD-8002^1000',
      'New South Wales^Castle Grayskull^0^ORD-8003^50000',

      // --- Ontario ---
      'Ontario^Jhos Miller^18667^ORD-7001^2383',
      'Ontario^Jhos Miller^27180^ORD-7002^2220',
      'Ontario^Jhos Miller^29600^ORD-7003^3250',
      'Ontario^Jhos Miller^130000^ORD-7004^2500',
      'New South Wales^He Man^14300^ORD-8001^3000',
      'Ontario^Jhos Miller^140000^ORD-7005^127750',
      'Ontario^Maple Leaf Goods^250^ORD-7006^1250',
      'Ontario^Toronto Traders^0^ORD-7007^8500',
      'Ontario^Toronto Traders^5000^ORD-7008^2300',

      // --- Texas ---
      'Texas^Lone Star Logistics^0^ORD-6001^55000',
      'Texas^Lone Star Logistics^1200^ORD-6002^4500',
      'Texas^Houston Energy^25000^ORD-6003^12000',
      'Texas^Austin Tech Hub^0^ORD-6004^9800',
      'Texas^Austin Tech Hub^500^ORD-6005^1500',
      'Texas^Ranger Rick^0^ORD-6006^350',

      // --- West champaran ---
      'West champaran^Alice Jhonson^10695^ORD-5001^2555',
      'West champaran^Alice Jhonson^15750^ORD-5002^1500',
      'West champaran^Alice Jhonson^249000^ORD-5003^27000',
      'West champaran^Alice Jhonson^560000^ORD-5004^5000',
      'West champaran^Emily^0^ORD-5005^89700',
      'West champaran^Emily^17200^ORD-5006^3500',
      'West champaran^Emily^44050^ORD-5007^1200',
      'West champaran^Emily^126200^ORD-5008^1000',
      'West champaran^Emily^170000^ORD-5009^8500',
    ],
    schemaJson: {
      grouping: {
        enabled: true,
        field: 'CustomerDistrict_t',
      },
      parts: {
        header: {
          height: 101,
          elements: [
            {
              type: 'label',
              key: null,
              content: 'Report by district',
              x: 260,
              y: 33,
              w: 150,
              h: 25,
              function: null,
              field: null,
              fontSize: 14,
              bold: false,
              italic: false,
              underline: false,
            },
          ],
        },
        'group-header': {
          height: 41,
          elements: [
            {
              type: 'field',
              key: 'CustomerDistrict_t',
              content: '[CustomerDistrict_t]',
              x: 17,
              y: 3,
              w: 150,
              h: 25,
              function: null,
              field: null,
              fontSize: 14,
              bold: true,
              italic: true,
              underline: true,
            },
          ],
        },
        body: {
          height: 61,
          elements: [
            {
              type: 'field',
              key: 'OrderID_t',
              content: '[OrderID_t]',
              x: 487,
              y: 9,
              w: 60,
              h: 27,
              function: null,
              field: null,
              fontSize: 14,
              bold: false,
              italic: false,
              underline: false,
            },
            {
              type: 'field',
              key: 'PaidAmount_n',
              content: '[PaidAmount_n]',
              x: 292,
              y: 11,
              w: 150,
              h: 25,
              function: null,
              field: null,
              fontSize: 14,
              bold: false,
              italic: false,
              underline: false,
            },
            {
              type: 'field',
              key: 'CustomerName_t',
              content: '[CustomerName_t]',
              x: 6,
              y: 12,
              w: 150,
              h: 25,
              function: null,
              field: null,
              fontSize: 14,
              bold: false,
              italic: false,
              underline: false,
            },
          ],
        },
        'group-footer': {
          height: 55,
          elements: [
            {
              type: 'calculation',
              key: null,
              content: '[]',
              x: 293,
              y: 7,
              w: 150,
              h: 25,
              function: 'SUM',
              field: 'PaidAmount_n',
              fontSize: 14,
              bold: true,
              italic: false,
              underline: false,
            },
          ],
        },
        footer: {
          height: 61,
          elements: [
            {
              type: 'calculation',
              key: null,
              content: '[]',
              x: 290,
              y: 12,
              w: 150,
              h: 25,
              function: 'SUM',
              field: 'PaidAmount_n',
              fontSize: 18,
              bold: true,
              italic: false,
              underline: false,
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
