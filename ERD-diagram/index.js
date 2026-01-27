const { Graph } = window.X6;

// ----------------------------------
// DOM References
// ----------------------------------
const container = document.getElementById('container');
const edgeControls = document.getElementById('edge-controls');
const relationTypeSelect = document.getElementById('relation-type');
const leftFieldSelect = document.getElementById('edge-left-field');
const rightFieldSelect = document.getElementById('edge-right-field');
const btnSaveRelation = document.getElementById('btnSaveRelation');
const btnCancelRelation = document.getElementById('btnCancelRelation');
const deleteModal = document.getElementById('delete-modal');
const btnConfirmDelete = document.getElementById('btnConfirmDelete');
const btnCancelDelete = document.getElementById('btnCancelDelete');

// ----------------------------------
// State
// ----------------------------------
let selectedEdge = null;
let edgeToDelete = null;
let currentGraphData = { tables: [], links: [] };

// ----------------------------------
// Constants
// ----------------------------------
const FIELD_HEIGHT = 36;
const HEADER_HEIGHT = 42;
const PORT_TOP_MARGIN = FIELD_HEIGHT / 2;

// ----------------------------------
// Graph Initialization
// ----------------------------------
const graph = new Graph({
  container,
  grid: {
    visible: true,
    type: 'doubleMesh',
    args: [
      { color: '#eee', thickness: 1 },
      { color: '#ddd', thickness: 1, factor: 4 },
    ],
  },
  mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'] },
  connecting: {
    snap: true,
    allowBlank: false,
    allowLoop: false,
    allowMulti: true,
    connector: { name: 'rounded', args: { radius: 8 } },
    router: { name: 'er' },
    validateConnection({ sourcePort, targetPort }) {
      // Only allow source from right ports and target from left ports
      return (
        String(sourcePort).includes('.R.') && String(targetPort).includes('.L.')
      );
    },
  },
  selecting: { enabled: true, multiple: false },
});

// ----------------------------------
// Build HTML
// ----------------------------------
function buildTableHtml(table) {
  const fields = table.fields || [];
  const collapsed =
    table.collapsed === undefined ? fields.length > 5 : table.collapsed;

  const fieldsHtml = fields
    .map((f, i) => {
      const extra = i >= 5 ? ' extra-field' : '';
      const hidden = collapsed && i >= 5 ? ' hidden' : '';
      return `<div class="er-field${extra}${hidden} ${
        table.baseTableKey == f.name ? 'base-tableKey' : ''
      }" data-name="${f.id || f.name}">${f.name}</div>`;
    })
    .join('');

  const showMoreButton =
    fields.length > 5
      ? `<button class="show-more" aria-expanded="${!collapsed}" title="Toggle fields" tabindex="0" type="button" aria-label="Toggle fields">\n        <span class="show-more-icon">${
          collapsed ? '\u25BC' : '\u25B2'
        }</span>\n      </button>`
      : '';

  return `
    <div class="er-table ${
      table.baseTable ? 'base-table' : ''
    }" data-node-id="${table.id}">
      <div class="er-header">
        <span class="er-title">${table.name}</span>
        <span class="">
         ${showMoreButton}
         <button class="btn-delete">X</button>
        </span>
      </div>
      <div class="er-fields-container">
        ${fieldsHtml}
      </div>
    </div>`;
}
// ----------------------------------
// Track Node Positions
// ----------------------------------
function saveNodePositions() {
  const positions = {};
  graph.getNodes().forEach((node) => {
    const pos = node.position();
    positions[node.id] = { x: pos.x, y: pos.y };
  });
  return positions;
}

// ----------------------------------
// Port connection formation
// ----------------------------------
function makePortsForTable(table) {
  return (table.fields || []).flatMap((f, i) => {
    const fid = f.id || f.name;

    if (table.baseTable) {
      // Base table  only right ports opens
      return [
        {
          id: `${table.id}.R.${fid}`,
          group: 'right',
          args: { y: HEADER_HEIGHT + i * FIELD_HEIGHT + PORT_TOP_MARGIN },
        },
      ];
    } else {
      // Other left and right ports opens
      return [
        {
          id: `${table.id}.L.${fid}`,
          group: 'left',
          args: { y: HEADER_HEIGHT + i * FIELD_HEIGHT + PORT_TOP_MARGIN },
        },
        {
          id: `${table.id}.R.${fid}`,
          group: 'right',
          args: { y: HEADER_HEIGHT + i * FIELD_HEIGHT + PORT_TOP_MARGIN },
        },
      ];
    }
  });
}

// Toggle visibility and interactivity of per-field ports for a specific table
function togglePortsVisibility(tableId, table, expanded) {
  const node = graph.getCell(tableId);
  const fieldIds = (table.fields || []).map((f) => f.id || f.name);

  // Helper to set a port attr if API is available
  const setPortAttr = (portId, path, value) => {
    try {
      if (typeof node.setPortProp === 'function') {
        node.setPortProp(portId, path, value);
        return true;
      }
      if (typeof node.portProp === 'function') {
        node.portProp(portId, path, value);
        return true;
      }
    } catch (e) {}
    return false;
  };

  // For each field after the first 5, hide/show their ports
  fieldIds.forEach((fid, i) => {
    if (i < 5) return; // only affect extra fields

    const leftPortId = `${tableId}.L.${fid}`;
    const rightPortId = `${tableId}.R.${fid}`;
    [leftPortId, rightPortId].forEach((pid) => {
      // If port doesn't exist on this table (e.g., base table left ports), ignore
      try {
        // Try the API first
        let applied = false;
        applied =
          setPortAttr(pid, 'attrs/circle/display', expanded ? null : 'none') ||
          applied;
        applied =
          setPortAttr(
            pid,
            'attrs/circle/pointerEvents',
            expanded ? null : 'none'
          ) || applied;
        applied =
          setPortAttr(pid, 'attrs/circle/opacity', expanded ? null : 0) ||
          applied;

        if (!applied) {
          // Fallback: try to find the port element in the node's DOM and hide/show it
          const nodeEl = container.querySelector(`[data-node-id="${tableId}"]`);
          if (!nodeEl) return;

          // Try multiple attribute selectors that X6 might use
          const selectors = [
            `[data-portid="${pid}"]`,
            `[data-port-id="${pid}"]`,
            `[data-port="${pid}"]`,
          ];
          selectors.forEach((sel) => {
            const portEls = nodeEl.querySelectorAll(sel);
            portEls.forEach((portEl) => {
              const circle = portEl.querySelector('circle');
              if (circle) {
                circle.style.display = expanded ? '' : 'none';
                circle.style.pointerEvents = expanded ? '' : 'none';
                circle.style.opacity = expanded ? '' : '0';
              }

              // Additionally, hide the port wrapper if exists
              portEl.style.display = expanded ? '' : 'none';
            });
          });
        }
      } catch (e) {
        // ignore per-port errors
        console.log('error in port congiguration', e);
      }
    });
  });
}

function addTableNode(table) {
  // default collapsed state when there are more than 5 fields
  if ((table.fields?.length || 0) > 5 && table.collapsed === undefined) {
    table.collapsed = true;
  }

  const visibleCount = table.collapsed
    ? Math.min(5, table.fields.length)
    : table.fields?.length || 1;
  const height = HEADER_HEIGHT + visibleCount * FIELD_HEIGHT + 10;

  graph.addNode({
    id: table.id,
    shape: 'html',
    x: table.position?.x ?? 60,
    y: table.position?.y ?? 60,
    width: 260,
    height,
    html: buildTableHtml(table),
    data: table,
    ports: {
      groups: {
        left: {
          position: { name: 'absolute', args: { x: 0 } },
          attrs: {
            circle: {
              magnet: 'passive',
              r: 6,
              stroke: '#0e7490',
              fill: '#fff',
            },
          },
        },
        right: {
          position: { name: 'absolute', args: { x: 260 } },
          attrs: {
            circle: { magnet: true, r: 6, stroke: '#0e7490', fill: '#fff' },
          },
        },
      },
      items: makePortsForTable(table),
    },
  });

  // If there are extra fields, attach the show-more handler without interfering with ports
  if ((table.fields?.length || 0) > 5) {
    // Defer to next tick to ensure DOM is attached
    setTimeout(() => {
      const nodeEl = container.querySelector(`[data-node-id="${table.id}"]`);
      if (!nodeEl) return;
      const btn = nodeEl.querySelector('.show-more');
      const extraFields = nodeEl.querySelectorAll('.er-field.extra-field');
      const update = (expanded) => {
        extraFields.forEach((el) => el.classList.toggle('hidden', !expanded));
        if (btn) {
          btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          btn.classList.toggle('expanded', expanded);
          const icon = btn.querySelector('.show-more-icon');
          if (icon) icon.textContent = expanded ? '\u25B2' : '\u25BC';
        }
        const newVisible = expanded ? table.fields.length : 5;
        const newHeight = HEADER_HEIGHT + newVisible * FIELD_HEIGHT + 10;
        const cell = graph.getCell(table.id);
        if (cell && typeof cell.resize === 'function')
          cell.resize(260, newHeight);

        // Also toggle ports visibility/interactivity for extra fields
        try {
          togglePortsVisibility(table.id, table, expanded);
        } catch (e) {
          console.log('error', e);
        }

        // Persist collapsed state back to currentGraphData if present
        try {
          const tableInData = (currentGraphData.tables || []).find(
            (t) => t.id === table.id
          );
          if (tableInData) tableInData.collapsed = !expanded; // collapsed === not expanded
          const nodeCell = graph.getCell(table.id);
          if (nodeCell)
            nodeCell.setData &&
              nodeCell.setData({
                ...(nodeCell.data || {}),
                collapsed: !expanded,
              });
        } catch (e) {}
      };

      // Initialize visual state
      update(!table.collapsed);

      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation(); // don't trigger node selection or drag
          table.collapsed = !table.collapsed;
          update(!table.collapsed);
        });
      }
    }, 0);
  }
  //for delete table
  setTimeout(() => {
    const nodeEl = container.querySelector(`[data-node-id="${table.id}"]`);
    if (!nodeEl) return;

    const deleteBtn = nodeEl.querySelector('.btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTableById(table.id);
      });
    }
  }, 0);
}

function updateEdgeLabelAndStyle(edge, relation) {
  const width = 10;
  const height = 2;

  edge.setLabels([
    {
      position: 0.5,
      attrs: {
        text: {
          text: relation,
          fill: '#05070eff',
          fontSize: 12,
          fontWeight: 600,
          textAnchor: 'middle',
        },
        rect: {
          fill: '#f8fafc',
          stroke: '#0f4991ff',
          rx: 6,
          ry: 20,

          refWidth: width,
          refHeight: height,

          refX: -width / 2,
          refY: -height / 2,
        },
      },
    },
  ]);

  edge.setData({ ...edge.getData(), relation });
}

function addRemoveButton(edge) {
  edge.removeTools();
  edge.addTools([
    {
      name: 'button-remove',
      args: {
        markup: [
          { tagName: 'circle', attrs: { r: 10, fill: '#ef4444' } },
          {
            tagName: 'text',
            textContent: 'X',
            attrs: {
              fill: '#fff',
              fontSize: 13,
              textAnchor: 'middle',
              dy: '0.4em',
            },
          },
        ],
        distance: 0.6,
        offset: { x: 20, y: 0 },
        onClick: () => {
          edgeToDelete = edge;
          deleteModal.classList.remove('hidden');
        },
      },
    },
  ]);
}

// ----------------------------------
// Add/Update link in currentGraphData
// ----------------------------------
function addOrUpdateLinkFromEdge(edge) {
  // console.log(edge);
  const srcNode = edge.getSourceNode();
  const tgtNode = edge.getTargetNode();
  if (!srcNode || !tgtNode) return;

  const srcFieldId = String(edge.getSource().port || '')
    .split('.')
    .pop();
  const tgtFieldId = String(edge.getTarget().port || '')
    .split('.')
    .pop();

  const newLink = {
    id: edge.id,
    source: `${srcNode.id}.R.${srcFieldId}`,
    target: `${tgtNode.id}.L.${tgtFieldId}`,
    relation: edge.getData()?.relation || '=',
    sourceTableName: srcNode.data?.name,
    sourceFieldName:
      srcNode.data?.fields.find((f) => f.id === srcFieldId)?.name || srcFieldId,
    targetTableName: tgtNode.data?.name,
    targetFieldName:
      tgtNode.data?.fields.find((f) => f.id === tgtFieldId)?.name || tgtFieldId,
  };

  currentGraphData.links = currentGraphData.links || [];
  const index = currentGraphData.links.findIndex((l) => l.id === newLink.id);
  if (index === -1) currentGraphData.links.push(newLink);
  else
    currentGraphData.links[index] = {
      ...currentGraphData.links[index],
      ...newLink,
    };
}

// ----------------------------------
// Add delete table
// ----------------------------------
function deleteTableById(tableId) {
  const node = graph.getCell(tableId);
  if (!node) return;

  node.remove();
  currentGraphData.tables = currentGraphData.tables.filter(
    (t) => t.id !== tableId
  );

  currentGraphData.links = currentGraphData.links.filter(
    (l) =>
      !l.source.startsWith(`${tableId}.`) && !l.target.startsWith(`${tableId}.`)
  );

  applyGlobalRelationCountSort();
}

// ----------------------------------
// GLOBAL: Sort tables & fields
// ----------------------------------
function applyGlobalRelationCountSort() {
  const updated = JSON.parse(
    JSON.stringify(currentGraphData || { tables: [], links: [] })
  );

  // Keep current positions
  const nodePositions = saveNodePositions();

  const relationCount = {};
  const tableToLinkedFieldIds = {};

  (updated.links || []).forEach((l) => {
    const [sTable, , sField] = String(l.source).split('.');
    const [tTable, , tField] = String(l.target).split('.');
    relationCount[sTable] = (relationCount[sTable] || 0) + 1;
    relationCount[tTable] = (relationCount[tTable] || 0) + 1;

    if (!tableToLinkedFieldIds[sTable])
      tableToLinkedFieldIds[sTable] = new Set();
    if (!tableToLinkedFieldIds[tTable])
      tableToLinkedFieldIds[tTable] = new Set();
    if (sField) tableToLinkedFieldIds[sTable].add(sField);
    if (tField) tableToLinkedFieldIds[tTable].add(tField);
  });

  updated.tables = (updated.tables || []).map((table) => {
    // Preserve current position
    if (nodePositions[table.id]) table.position = nodePositions[table.id];

    const linkedFields = Array.from(tableToLinkedFieldIds[table.id] || []);
    if (!table.fields) return table;

    const linked = [],
      other = [];
    table.fields.forEach((f) => {
      const fid = f.id || f.name;
      linkedFields.includes(fid) ? linked.push(f) : other.push(f);
    });

    return { ...table, fields: [...linked, ...other] };
  });

  // Sort tables by relation count descending
  updated.tables.sort(
    (a, b) => (relationCount[b.id] || 0) - (relationCount[a.id] || 0)
  );

  currentGraphData = updated;
  loadGraphData(updated);
}

// ----------------------------------
// Edge Events
// ----------------------------------
graph.on('edge:connected', ({ edge }) => {
  updateEdgeLabelAndStyle(edge, edge.getData()?.relation || '=');
  addRemoveButton(edge);
  addOrUpdateLinkFromEdge(edge);
  applyGlobalRelationCountSort();
});
// ----------------------------------
// Relation-ship Events
// ----------------------------------
graph.on('edge:click', ({ edge }) => {
  selectedEdge = edge;
  relationTypeSelect.value = edge.getData()?.relation || '=';

  const srcNode = edge.getSourceNode();
  const tgtNode = edge.getTargetNode();

  leftFieldSelect.innerHTML = (tgtNode.data.fields || [])
    .map((f) => `<option value="${f.id}">${f.name}</option>`)
    .join('');
  rightFieldSelect.innerHTML = (srcNode.data.fields || [])
    .map((f) => `<option value="${f.id}">${f.name}</option>`)
    .join('');

  leftFieldSelect.value = edge.getTarget().port.split('.').pop();
  rightFieldSelect.value = edge.getSource().port.split('.').pop();

  const rect = container.getBoundingClientRect();
  edgeControls.style.left =
    rect.left + (rect.width - edgeControls.offsetWidth) / 2 + 'px';
  edgeControls.style.top = '50px';
  edgeControls.style.display = 'block';
});

graph.on('blank:click node:click', () => {
  edgeControls.style.display = 'none';
  selectedEdge = null;
});

// ----------------------------------
// Save / Cancel Relation
// ----------------------------------
btnSaveRelation.addEventListener('click', () => {
  if (!selectedEdge) return;

  const relation = relationTypeSelect.value;
  const newLeftField = leftFieldSelect.value;
  const newRightField = rightFieldSelect.value;

  const srcNode = selectedEdge.getSourceNode();
  const tgtNode = selectedEdge.getTargetNode();

  selectedEdge.setSource({
    cell: srcNode.id,
    port: `${srcNode.id}.R.${newRightField}`,
  });
  selectedEdge.setTarget({
    cell: tgtNode.id,
    port: `${tgtNode.id}.L.${newLeftField}`,
  });
  updateEdgeLabelAndStyle(selectedEdge, relation);

  const link = currentGraphData.links.find((l) => l.id === selectedEdge.id);
  if (link) {
    link.source = `${srcNode.id}.R.${newRightField}`;
    link.target = `${tgtNode.id}.L.${newLeftField}`;
    link.relation = relation;
  }

  applyGlobalRelationCountSort();
  edgeControls.style.display = 'none';
  selectedEdge = null;
});

btnCancelRelation.addEventListener('click', () => {
  edgeControls.style.display = 'none';
  selectedEdge = null;
});

// ----------------------------------
// Delete Edge Modal
// ----------------------------------
btnCancelDelete.addEventListener('click', () => {
  edgeToDelete = null;
  deleteModal.classList.add('hidden');
});

btnConfirmDelete.addEventListener('click', () => {
  if (edgeToDelete) {
    try {
      edgeToDelete.remove();
    } catch (e) {}
    currentGraphData.links = currentGraphData.links.filter(
      (l) => l.id !== edgeToDelete.id
    );
    applyGlobalRelationCountSort();
  }
  deleteModal.classList.add('hidden');
  edgeToDelete = null;
});
///////////////////////////////------------------
function refreshTablesFromJSON(newJson) {
  if (!newJson || !Array.isArray(newJson.tables)) return;

  // Existing tables lookup (by id + name)
  const existingTableKey = new Set(
    (currentGraphData.tables || []).map((t) => `${t.id}::${t.name}`)
  );

  let added = false;

  // 1️⃣ Add missing tables
  newJson.tables.forEach((table) => {
    const key = `${table.id}::${table.name}`;
    if (!existingTableKey.has(key)) {
      // deep clone to avoid mutation
      const clonedTable = JSON.parse(JSON.stringify(table));

      // default position (center-ish)
      clonedTable.position = {
        x: Math.random() * 300 + 100,
        y: Math.random() * 200 + 100,
      };

      currentGraphData.tables.push(clonedTable);
      added = true;
    }
  });

  // 2️⃣ Add missing links ONLY if both tables exist
  if (Array.isArray(newJson.links)) {
    const existingLinkIds = new Set(
      (currentGraphData.links || []).map((l) => l.id)
    );

    newJson.links.forEach((link) => {
      if (existingLinkIds.has(link.id)) return;

      const [sTable] = link.source.split('.');
      const [tTable] = link.target.split('.');

      const tableExists = currentGraphData.tables.some(
        (t) => t.id === sTable || t.id === tTable
      );

      if (tableExists) {
        currentGraphData.links.push(JSON.parse(JSON.stringify(link)));
        added = true;
      }
    });
  }

  // 3️⃣ Rebuild graph ONLY if something changed
  if (added) {
    applyGlobalRelationCountSort();
  }
}

// ----------------------------------
// Load Graph
// ----------------------------------
function loadGraphData(data) {
  currentGraphData = JSON.parse(JSON.stringify(data));
  graph.clearCells();

  const nodeMap = {};
  currentGraphData.tables.forEach((table) => {
    addTableNode(table);
    nodeMap[table.id] = table;
  });

  (currentGraphData.links || []).forEach((l) => {
    const [srcTableId, , srcFieldId] = String(l.source).split('.');
    const [tgtTableId, , tgtFieldId] = String(l.target).split('.');
    const srcNode = nodeMap[srcTableId];
    const tgtNode = nodeMap[tgtTableId];
    if (!srcNode || !tgtNode) return;

    const edge = graph.addEdge({
      id: l.id,
      source: { cell: srcNode.id, port: `${srcNode.id}.R.${srcFieldId}` },
      target: { cell: tgtNode.id, port: `${tgtNode.id}.L.${tgtFieldId}` },
      attrs: {
        line: {
          stroke: '#A2B1C3',
          strokeWidth: 2,
          targetMarker: { name: 'classic', size: 8 },
        },
      },
      data: { ...l },
    });

    updateEdgeLabelAndStyle(edge, l.relation);
    addRemoveButton(edge);
  });
}

// ----------------------------------
// SQL Generation buildSqlMap()
// ----------------------------------
function buildSqlMap() {
  const { tables, links } = currentGraphData;
  if (!tables || !tables.length) return [];

  const sqlMap = [];

  const baseTable = tables.find((t) => t.baseTable);
  if (!baseTable || !baseTable.baseTableKey) return sqlMap;

  const baseTableName = baseTable.name;
  const baseTableKey = baseTable.baseTableKey;

  // Helper function find direct link between two tables
  const findLink = (a, b) =>
    links.find(
      (l) =>
        (l.sourceTableName === a && l.targetTableName === b) ||
        (l.targetTableName === a && l.sourceTableName === b)
    );

  tables.forEach((table) => {
    const tableEntry = {
      tableId: table.id,
      tableName: table.name,
      fields: [],
    };

    table.fields.forEach((field) => {
      let sql = '';
      let joinLevel = 0;

      // ---------------------------
      // BASE TABLE (LEVEL 0)
      // ---------------------------
      if (table.baseTable) {
        joinLevel = 0;

        sql =
          `SELECT \\\"${field.name}\\\" FROM \\\"${table.name}\\\" ` +
          `WHERE \\\"${baseTableKey}\\\" = '"&${table.name}::${baseTableKey}&"'`;
      }

      // ---------------------------
      // LEVEL 1 (Direct to base)
      // ---------------------------
      else {
        const level1Link = findLink(baseTableName, table.name);

        if (level1Link) {
          joinLevel = 1;

          const fk =
            level1Link.sourceTableName === baseTableName
              ? level1Link.targetFieldName
              : level1Link.sourceFieldName;

          const pk =
            level1Link.sourceTableName === baseTableName
              ? level1Link.sourceFieldName
              : level1Link.targetFieldName;

          sql =
            `SELECT \\\"${field.name}\\\" FROM \\\"${table.name}\\\" ` +
            `WHERE \\\"${fk}\\\" = '"&${baseTableName}::${pk}&"'`;
        }

        // ---------------------------
        // LEVEL 2 (via level-1 table)
        // ---------------------------
        else {
          const level1Table = tables.find(
            (t) =>
              findLink(baseTableName, t.name) && findLink(t.name, table.name)
          );

          if (!level1Table) return;

          const linkBaseToL1 = findLink(baseTableName, level1Table.name);
          const linkL1ToL2 = findLink(level1Table.name, table.name);

          joinLevel = 2;

          const baseFK =
            linkBaseToL1.sourceTableName === baseTableName
              ? linkBaseToL1.sourceFieldName
              : linkBaseToL1.targetFieldName;

          const level1PK =
            linkBaseToL1.sourceTableName === baseTableName
              ? linkBaseToL1.targetFieldName
              : linkBaseToL1.sourceFieldName;

          const level1FK =
            linkL1ToL2.sourceTableName === level1Table.name
              ? linkL1ToL2.sourceFieldName
              : linkL1ToL2.targetFieldName;

          const level2PK =
            linkL1ToL2.sourceTableName === level1Table.name
              ? linkL1ToL2.targetFieldName
              : linkL1ToL2.sourceFieldName;

          sql =
            `SELECT \\\"${field.name}\\\" FROM \\\"${table.name}\\\" ` +
            `WHERE \\\"${level2PK}\\\" = (` +
            `SELECT \\\"${level1FK}\\\" FROM \\\"${level1Table.name}\\\" ` +
            `WHERE \\\"${level1PK}\\\" = '"&${baseTableName}::${baseFK}&"'` +
            `)`;
        }
      }

      if (!sql) return;

      tableEntry.fields.push({
        fieldId: field.id,
        fieldName: field.name,
        sql,
        joinLevel,
      });
    });

    if (tableEntry.fields.length) {
      sqlMap.push(tableEntry);
    }
  });

  return sqlMap;
}

// ----------------------------------
// Center Graph
// ----------------------------------
function zoomInGraph() {
  graph.centerContent();
  const currentZoom = graph.zoom();
  graph.zoomTo(currentZoom * 0.85);
}
document
  .getElementById('btnCenter')
  .addEventListener('click', () => graph.centerContent());

// ----------------------------------
// Export JSON
// ----------------------------------
document.getElementById('btnExport').addEventListener('click', () => {
  const exportData = JSON.parse(JSON.stringify(currentGraphData));
  const sqlMap = buildSqlMap();
  graph.getNodes().forEach((node) => {
    const pos = node.position();
    const table = exportData.tables.find((t) => t.id === node.id);
    if (table) table.position = { x: pos.x, y: pos.y };
  });
  exportData.sqlMap = sqlMap;
  const json = JSON.stringify(exportData, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'erd-export.json';
  a.click();
});

// ----------------------------------
// demo api json call for graph
// ----------------------------------
document.getElementById('btnLoadDemo').addEventListener('click', () => {
  fetch('http://localhost:8000/demoJSON/erdJSON.json')
    .then((res) => res.json())
    .then((jsonData) => {
      currentGraphData = JSON.parse(JSON.stringify(jsonData));
      applyGlobalRelationCountSort();
      zoomInGraph();
    })
    .catch((err) => console.error('Failed to load demo JSON:', err));
});

// ---------------------------------------------------------------
// FileMaker window function calls for intraction with web viewer
// ---------------------------------------------------------------
window.receiveJSONFromFM = (jsonString) => {
  try {
    const parsed = JSON.parse(jsonString);
    currentGraphData = JSON.parse(JSON.stringify(parsed));
    applyGlobalRelationCountSort();
    zoomInGraph();
  } catch (e) {
    alert('Invalid JSON from FileMaker');
    console.error(e);
  }
};

window.refreshTable = (jsonString) => {
  try {
    const parsed = JSON.parse(jsonString);
    refreshTablesFromJSON(parsed);
  } catch (e) {
    alert('Invalid JSON from FileMaker');
    console.error(e);
  }
};

window.updateBaseTable = (newBaseTableName) => {
  currentGraphData.tables.forEach(
    (t) => (t.baseTable = t.name === newBaseTableName)
  );
  applyGlobalRelationCountSort();
};

window.updateBaseTableKey = (newBaseTableKeyName) => {
  console.log(currentGraphData);
  currentGraphData.tables.forEach((t) => {
    if (t.baseTable === true) {
      t.baseTableKey = newBaseTableKeyName;
    }
  });
  applyGlobalRelationCountSort();
};

window.sendJSON = async () => {
  const exportData = JSON.parse(JSON.stringify(currentGraphData));
  const sqlMap = buildSqlMap();
  graph.getNodes().forEach((node) => {
    const pos = node.position();
    const table = exportData.tables.find((t) => t.id === node.id);
    if (table) table.position = { x: pos.x, y: pos.y };
  });
  exportData.sqlMap = sqlMap;
  const jsonData = JSON.stringify(exportData, null, 2);

  if (window.FileMaker && FileMaker.PerformScript) {
    FileMaker.PerformScript('receiveJSON', jsonData);
  }
};
