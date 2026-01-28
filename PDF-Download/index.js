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
        el.bold && el.italic ? 'bolditalic'
          : el.bold ? 'bold'
            : el.italic ? 'italic'
              : 'normal';
      doc.setFont('helvetica', fontStyle);

      let text = '';

      // --- DYNAMIC CONTENT HANDLING ---
      if (el.type === 'label') {
        text = el.content;
      }
      else if (el.type === 'field') {
        // Standard Field from Row Data
        let key = el.key || el.content.replace(/[\[\]]/g, '');
        text = rowData ? String(rowData[key] ?? '') : '';
      }
      else if (el.type === 'calculation') {
        // --- DYNAMIC CALCULATION ---
        // 1. We look at the JSON Schema to see WHICH field this element wants (el.field)
        // 2. We look at the passed 'aggregates' object to find that value.
        // 3. This works for ANY field, without hardcoding names in JavaScript.
        
        const fieldName = el.field; // e.g., "DueAmount_n" or "PaidAmount_n"
        const val = (aggregates && aggregates[fieldName]) ? aggregates[fieldName] : 0;

        text = val.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
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
    Object.keys(row).forEach(key => {
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
  "columnHeader": [
    "InvoiceID",
    "Date_d",
    "Region_t",
    "Category_t",
    "Product_t",
    "Qty_n",
    "UnitPrice_n",
    "TotalLine_n"
  ],
  "bodyData": [
    "INV-1001^2023-10-01^East^Electronics^Laptop^2^1200.00^2400.00",
    "INV-1002^2023-10-01^East^Accessories^Mouse^10^25.00^250.00",
    "INV-1003^2023-10-02^East^Furniture^Desk^1^450.00^450.00",
    "INV-1004^2023-10-03^East^Electronics^Monitor^2^300.00^600.00",
    "INV-1005^2023-10-05^East^Accessories^Keyboard^5^50.00^250.00",
    "INV-1006^2023-10-06^East^Furniture^Chair^4^150.00^600.00",
    "INV-1007^2023-10-01^North^Electronics^Laptop^1^1200.00^1200.00",
    "INV-1008^2023-10-02^North^Furniture^Desk^2^400.00^800.00",
    "INV-1009^2023-10-03^North^Electronics^Headphones^5^100.00^500.00",
    "INV-1010^2023-10-04^North^Accessories^USB Hub^10^20.00^200.00",
    "INV-1011^2023-10-05^North^Furniture^Bookshelf^2^150.00^300.00",
    "INV-1012^2023-10-06^North^Electronics^Tablet^3^300.00^900.00",
    "INV-1013^2023-10-07^North^Accessories^Webcam^4^60.00^240.00",
    "INV-1014^2023-10-08^North^Furniture^Chair^6^120.00^720.00",
    "INV-1015^2023-10-01^South^Electronics^Projector^1^800.00^800.00",
    "INV-1016^2023-10-02^South^Accessories^Cable Pack^20^10.00^200.00",
    "INV-1017^2023-10-03^South^Furniture^Cabinet^1^350.00^350.00",
    "INV-1018^2023-10-04^South^Electronics^Laptop^3^1100.00^3300.00",
    "INV-1019^2023-10-05^South^Accessories^Mousepad^50^5.00^250.00",
    "INV-1020^2023-10-01^West^Electronics^Phone^4^800.00^3200.00",
    "INV-1021^2023-10-02^West^Electronics^Laptop^2^1250.00^2500.00",
    "INV-1022^2023-10-03^West^Furniture^Standing Desk^1^600.00^600.00",
    "INV-1023^2023-10-04^West^Accessories^Monitor Arm^2^80.00^160.00",
    "INV-1024^2023-10-05^West^Electronics^Tablet^5^250.00^1250.00",
    "INV-1025^2023-10-06^West^Furniture^Ergo Chair^2^500.00^1000.00",
    "INV-1026^2023-10-07^West^Accessories^Docking Stn^3^150.00^450.00",
    "INV-1027^2023-10-08^West^Electronics^Speaker^4^100.00^400.00",
    "INV-1028^2023-10-09^West^Furniture^Lamp^10^30.00^300.00",
    "INV-1029^2023-10-10^West^Accessories^Headset^5^80.00^400.00",
    "INV-1030^2023-10-11^West^Electronics^Charger^15^20.00^300.00"
  ],
  "schemaJson": {
    "grouping": {
      "enabled": true,
      "field": "Region_t"
    },
    "parts": {
      "header": {
        "height": 80,
        "elements": [
          {
            "type": "label",
            "content": "SALES PERFORMANCE REPORT",
            "x": 20, "y": 20, "fontSize": 18, "bold": true
          },
          {
            "type": "label",
            "content": "Grand Total Revenue:",
            "x": 350, "y": 25, "fontSize": 12, "bold": true
          },
          {
            "type": "calculation",
            "field": "TotalLine_n", 
            "x": 480, "y": 25, "fontSize": 14, "bold": true,
            "function": "SUM"
          },
          {
            "type": "label",
            "content": "Date", "x": 20, "y": 60, "fontSize": 10, "bold": true, "underline": true
          },
          {
            "type": "label",
            "content": "Product", "x": 100, "y": 60, "fontSize": 10, "bold": true, "underline": true
          },
          {
            "type": "label",
            "content": "Category", "x": 250, "y": 60, "fontSize": 10, "bold": true, "underline": true
          },
          {
            "type": "label",
            "content": "Qty", "x": 380, "y": 60, "fontSize": 10, "bold": true, "underline": true
          },
          {
            "type": "label",
            "content": "Total", "x": 450, "y": 60, "fontSize": 10, "bold": true, "underline": true
          }
        ]
      },
      "group-header": {
        "height": 30,
        "elements": [
          {
            "type": "field",
            "key": "Region_t",
            "x": 20, "y": 5, "fontSize": 12, "bold": true, "italic": true
          }
        ]
      },
      "body": {
        "height": 25,
        "elements": [
          { "type": "field", "key": "Date_d", "x": 20, "y": 5, "fontSize": 10 },
          { "type": "field", "key": "Product_t", "x": 100, "y": 5, "fontSize": 10 },
          { "type": "field", "key": "Category_t", "x": 250, "y": 5, "fontSize": 10 },
          { "type": "field", "key": "Qty_n", "x": 380, "y": 5, "fontSize": 10 },
          { "type": "field", "key": "TotalLine_n", "x": 450, "y": 5, "fontSize": 10 }
        ]
      },
      "group-footer": {
        "height": 40,
        "elements": [
          {
            "type": "label",
            "content": "Region Summary:",
            "x": 150, "y": 5, "fontSize": 10, "italic": true
          },
          {
            "type": "label",
            "content": "Total Qty:",
            "x": 300, "y": 5, "fontSize": 10, "bold": true
          },
          {
            "type": "calculation",
            "field": "Qty_n",
            "x": 355, "y": 5, "fontSize": 10, "bold": true
          },
          {
            "type": "label",
            "content": "Total Rev:",
            "x": 400, "y": 5, "fontSize": 10, "bold": true
          },
          {
            "type": "calculation",
            "field": "TotalLine_n",
            "x": 460, "y": 5, "fontSize": 10, "bold": true,
            "underline": true
          }
        ]
      },
      "footer": {
        "height": 40,
        "elements": [
          {
            "type": "label",
            "content": "End of Report",
            "x": 250, "y": 10, "fontSize": 10, "italic": true
          },
           {
            "type": "label",
            "content": "Grand Total Qty Sold:",
            "x": 20, "y": 10, "fontSize": 10
          },
          {
            "type": "calculation",
            "field": "Qty_n",
            "x": 120, "y": 10, "fontSize": 10, "bold": true
          }
        ]
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
