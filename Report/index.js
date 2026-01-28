// STATE & DATA STORE
const Store = {
  data: [],
  headers: [],
  selectedElement: null,
  grouping: { enabled: false, field: null },
};

/**
 * 2. REPORT ENGINE
 */
const ReportEngine = {
  calculate(funcName, fieldName, dataSource) {
    // If inside a group, dataSource will be groupRows. If header/footer, it's reportData.
    const records = dataSource || [];
    if (records.length === 0) return '0';
    const vals = records
      .map((r) => r[fieldName])
      .filter((v) => v !== undefined && v !== null && v !== '')
      .map((v) => Number(v));

    if (vals.length === 0) return '0';

    let res = 0;
    if (funcName === 'SUM') res = vals.reduce((a, b) => a + b, 0);
    else if (funcName === 'AVG')
      res = vals.reduce((a, b) => a + b, 0) / vals.length;
    else if (funcName === 'COUNT') res = vals.length;

    return res.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  },

  getSchema() {
    const s = {
      grouping: {
        enabled: Store.grouping.enabled === true,
        field: Store.grouping.field || null,
      },
      parts: {},
    };

    ['header', 'group-header', 'body', 'group-footer', 'footer'].forEach(
      (p) => {
        const partEl = document.getElementById('part-' + p);
        if (!partEl || partEl.style.display === 'none') return;

        s.parts[p] = {
          height: partEl.offsetHeight,
          elements: [...partEl.querySelectorAll('.canvas-element')].map((e) => {
            const contentEl = e.querySelector('.element-content');

            return {
              type: e.dataset.type,
              key: e.dataset.key || null,
              content:
                e.dataset.type === 'label'
                  ? contentEl?.textContent.trim() || ''
                  : `[${e.dataset.key}]`,
              x: Math.round(parseFloat(e.dataset.x)) || 0,
              y: Math.round(parseFloat(e.dataset.y)) || 0,
              w: Math.round(parseFloat(e.style.width)) || 150,
              h: Math.round(parseFloat(e.style.height)) || 22,
              function: e.dataset.function || null,
              field: e.dataset.field || null,
              fontSize: parseInt(contentEl?.style.fontSize, 10) || 14,
              bold: contentEl?.style.fontWeight === 'bold',
              italic: contentEl?.style.fontStyle === 'italic',
              underline: contentEl?.style.textDecoration === 'underline',
            };
          }),
        };
      },
    );
    return s;
  },
};

/**
 * 3. RENDERER
 */
const Renderer = {
  getPartBaseStyle(name, height) {
    let style = `position: relative; width: 100%; height: ${height}px; overflow: hidden; box-sizing: border-box; `;
    if (name === 'header')
      style += 'background-color: #f8f9fa; border-bottom: 2px solid #333; ';
    if (name === 'group-header')
      style +=
        'background-color: #e9ecef; border-bottom: 1px solid #dee2e6; font-weight: bold; ';
    if (name === 'body')
      style += 'background-color: white; border-bottom: 1px solid #f1f3f5; ';
    if (name === 'group-footer')
      style +=
        'background-color: #fff9db; border-bottom: 1px dashed #ffd782ff; border-bottom: 1px solid #dee2e6; ';
    if (name === 'footer')
      style +=
        'background-color: #f8f9fa; border-top: 2px solid #333; margin-top: auto; ';
    return style;
  },

  renderPart(pName, pDef, row = null, calcDataSource = null) {
    const div = document.createElement('div');
    div.style.cssText = this.getPartBaseStyle(pName, pDef.height);

    pDef.elements.forEach((e) => {
      const el = document.createElement('div');
      let elStyle = `position: absolute; left: ${e.x}px; top: ${e.y}px; width: ${e.w}px; height: ${e.h}px; `;
      elStyle += `font-size: ${e.fontSize}px; display: flex; align-items: center; white-space: nowrap; `;
      if (e.bold) elStyle += 'font-weight: bold; ';
      if (e.italic) elStyle += 'font-style: italic; ';
      if (e.underline) elStyle += 'text-decoration: underline; ';
      el.style.cssText = elStyle;

      if (e.type === 'field') {
        el.textContent = row ? (row[e.key] ?? '') : `[${e.key}]`;
      } else if (e.type === 'calculation') {
        el.textContent = ReportEngine.calculate(
          e.function,
          e.field,
          calcDataSource,
        );
      } else {
        el.textContent = e.content || '';
      }
      div.appendChild(el);
    });

    return div;
  },

  createCanvasElement(parent, config) {
    const {
      x,
      y,
      type,
      key,
      content,
      w = 150,
      h = 25,
      field,
      function: funcName,
      fontSize,
      bold,
      italic,
      underline,
    } = config;
    const el = document.createElement('div');
    el.className = 'canvas-element' + (type === 'label' ? ' is-label' : '');
    Object.assign(el.style, {
      width: w + 'px',
      height: h + 'px',
      transform: `translate(${x}px,${y}px)`,
      position: 'absolute',
    });
    Object.assign(el.dataset, {
      x,
      y,
      type,
      key: key || '',
      function: funcName || '',
      field: field || '',
    });

    if (fontSize) el.dataset.fontSize = String(fontSize);
    if (bold) el.dataset.bold = '1';
    if (italic) el.dataset.italic = '1';
    if (underline) el.dataset.underline = '1';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'element-content';
    contentDiv.style.width = '100%';

    if (type === 'calculation') {
      this.setupCalculationUI(el, contentDiv, funcName, field);
    } else if (type === 'label') {
      contentDiv.contentEditable = true;
      contentDiv.textContent = content || '';
    } else {
      // Show a sample value for fields when possible (e.g., header/footer)
      if (key) {
        const parentPart = parent?.dataset?.part;
        if (
          (parentPart === 'header' || parentPart === 'footer') &&
          Store.data &&
          Store.data.length > 0
        ) {
          contentDiv.textContent = Store.data[0][key] ?? `[${key}]`;
        } else {
          contentDiv.textContent = key ? `[${key}]` : '';
        }
      } else {
        contentDiv.textContent = '';
      }
    }

    // Apply any formatting passed in config or via dataset
    const applyFormattingToContent = () => {
      const fs = fontSize || el.dataset.fontSize || null;
      if (fs) contentDiv.style.fontSize = (fs ? String(fs) : 14) + 'px';
      if (bold || el.dataset.bold === '1') contentDiv.style.fontWeight = 'bold';
      if (italic || el.dataset.italic === '1')
        contentDiv.style.fontStyle = 'italic';
      if (underline || el.dataset.underline === '1')
        contentDiv.style.textDecoration = 'underline';
    };
    applyFormattingToContent();

    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.textContent = '⋮⋮';
    el.append(handle, contentDiv);

    // Allow focusing the content area and sync toolbar when it changes
    contentDiv.tabIndex = 0;
    contentDiv.addEventListener('focus', () => {
      Actions.selectElement(el);
      Actions.syncFormattingToolbar(el);
    });
    contentDiv.addEventListener('input', () => {
      // If user changes content or uses keyboard formatting, keep toolbar in sync
      Actions.syncFormattingToolbar(el);
    });
    contentDiv.addEventListener('keyup', () =>
      Actions.syncFormattingToolbar(el),
    );

    // Watch for style changes on the content to update toolbar automatically
    const mo = new MutationObserver(() => Actions.syncFormattingToolbar(el));
    mo.observe(contentDiv, { attributes: true, attributeFilter: ['style'] });
    // Also observe style changes on the element itself (some scripts may set styles on the parent)
    const moEl = new MutationObserver(() => Actions.syncFormattingToolbar(el));
    moEl.observe(el, { attributes: true, attributeFilter: ['style'] });

    el.addEventListener('click', (e) => Actions.selectElement(el, e));
    parent.appendChild(el);
  },

  setupCalculationUI(el, container, funcName, savedField) {
    const select = document.createElement('select');
    select.style.cssText =
      'font-size: 11px; width: 100%; border: 1px solid #ccc;';

    const fields = Store.headers.length > 0 ? Store.headers : [];
    select.innerHTML =
      `<option value="">-- field --</option>` +
      fields
        .map(
          (k) =>
            `<option value="${k}" ${
              savedField === k ? 'selected' : ''
            }>${k}</option>`,
        )
        .join('');

    const resDisp = document.createElement('div');
    resDisp.className = 'calc-result';

    if (savedField) resDisp.textContent = `${funcName}(${savedField})`;

    select.onchange = (e) => {
      el.dataset.field = e.target.value;
      resDisp.textContent = e.target.value
        ? `${funcName}(${e.target.value})`
        : '';
    };

    container.innerHTML = '';
    container.append(select, resDisp);
  },
};

/**
 * 4. ACTIONS
 */
const Actions = {
  init() {
    this.setupPartResizing();
    this.setupDropZones();
    this.setupPartToggles();
    this.setupFormattingBar();
    this.setupKeyboardListeners();
    this.loadHeaders();
    this.setupGroupingControls();
    this.syncGroupingState(); // Sync on startup
  },

  // 1 Sync check box
  syncGroupingState() {
    const groupCB = document.getElementById('keep-group');
    const ghCB = document.getElementById('keep-group-header');
    const gfCB = document.getElementById('keep-group-footer');
    const sel = document.getElementById('group-by-field');

    const controls = document.getElementById('group-controls');
    const ghPart = document.getElementById('part-group-header');
    const gfPart = document.getElementById('part-group-footer');

    const groupOn = groupCB.checked;
    const hasField = !!sel.value;
    const hasChild = ghCB.checked || gfCB.checked;

    /* ---------- UI ---------- */

    // controls + dropdown
    controls.style.display = groupOn ? 'block' : 'none';
    sel.style.display = groupOn ? 'block' : 'none';

    // group parts
    ghPart.style.display = groupOn && ghCB.checked ? 'block' : 'none';
    gfPart.style.display = groupOn && gfCB.checked ? 'block' : 'none';

    /* ---------- STORE ---------- */

    Store.grouping.enabled = groupOn && hasField && hasChild;
    Store.grouping.field = Store.grouping.enabled ? sel.value : null;

    // hard reset if master off
    if (!groupOn) {
      ghCB.checked = false;
      gfCB.checked = false;
      Store.grouping.enabled = false;
      Store.grouping.field = null;
    }
  },
  // 2️ Setup child toggles to update master dynamically
  setupPartToggles() {
    const toggleMap = {
      header: 'keep-header',
      body: 'keep-body',
      footer: 'keep-footer',
      'group-header': 'keep-group-header',
      'group-footer': 'keep-group-footer',
    };

    // Normal part toggles
    Object.entries(toggleMap).forEach(([part, cbId]) => {
      const cb = document.getElementById(cbId);
      const partEl = document.getElementById('part-' + part);

      if (!cb || !partEl) return;

      cb.addEventListener('change', () => {
        if (part.startsWith('group-')) {
          const master = document.getElementById('keep-group');
          partEl.style.display =
            master.checked && cb.checked ? 'block' : 'none';
        } else {
          partEl.style.display = cb.checked ? 'block' : 'none';
        }
      });
    });

    // GROUP MASTER
    const groupCB = document.getElementById('keep-group');
    const groupControls = document.getElementById('group-controls');
    const groupSelect = document.getElementById('group-by-field');

    const ghCB = document.getElementById('keep-group-header');
    const gfCB = document.getElementById('keep-group-footer');

    const ghPart = document.getElementById('part-group-header');
    const gfPart = document.getElementById('part-group-footer');

    groupCB.addEventListener('change', () => {
      const enabled = groupCB.checked;

      // show / hide group controls INCLUDING select
      groupControls.style.display = enabled ? 'block' : 'none';
      groupSelect.style.display = enabled ? 'block' : 'none';

      if (!enabled) {
        // hard-disable children
        ghCB.checked = false;
        gfCB.checked = false;

        ghPart.style.display = 'none';
        gfPart.style.display = 'none';

        Store.grouping.enabled = false;
        Store.grouping.field = null;
      } else {
        // restore child visibility
        ghPart.style.display = ghCB.checked ? 'block' : 'none';
        gfPart.style.display = gfCB.checked ? 'block' : 'none';

        Store.grouping.enabled = true;
      }
    });
  },
  setupGroupingControls() {
    const sel = document.getElementById('group-by-field');
    if (!sel) return;
    sel.addEventListener('change', () => this.syncGroupingState());
  },
  async loadHeaders() {
    try {
      const list = document.getElementById('fields-list');
      const groupSel = document.getElementById('group-by-field');
      groupSel.innerHTML = '<option value="">Loading ...</option>';
      list.innerHTML = 'Loading fields...';
      // setTimeout(async () => {
      //   const res = await fetch(
      //     'http://localhost:8000/demoJSON/layoutHeaderJSON.json',
      //   );
      //   Store.headers = await res.json();
      //   this.populateFields();
      // }, 1000);
    } catch (e) {
      console.log(e);
      Store.headers = [];
    }
  },
  populateFields() {
    const list = document.getElementById('fields-list');
    const groupSel = document.getElementById('group-by-field');

    if (list) {
      list.innerHTML = '';
      Store.headers.forEach((k) => {
        const d = document.createElement('div');
        d.className = 'tool-item';
        d.draggable = true;
        d.textContent = k;
        d.dataset.type = 'field';
        d.dataset.key = k;
        d.ondragstart = (e) => {
          e.dataTransfer.setData('type', 'field');
          e.dataTransfer.setData('key', k);
        };
        list.appendChild(d);
      });
    }

    if (groupSel) {
      groupSel.innerHTML =
        '<option value="">-- Group By --</option>' +
        Store.headers.map((h) => `<option value="${h}">${h}</option>`).join('');
    }

    this.syncGroupingState();
  },
  async generatePreview() {
    // 1. Force sync before doing anything
    this.syncGroupingState();

    const out = document.getElementById('preview-content');
    const schema = ReportEngine.getSchema();
    document.getElementById('preview-modal').style.display = 'flex';
    out.innerHTML = 'Loading...';
    //call filemkaer script to recieve JSON data
    FileMaker.PerformScript('GenerateReportJSON');
    // try {
    //   setTimeout(async () => {
    //     const res = await fetch(
    //       'http://localhost:8000/demoJSON/layoutJSON.json',
    //     );
    //     Store.data = await res.json();
    //     this.renderPreviewHTML(schema, out);
    //   }, 1000);
    // } catch (e) {
    //   console.log(e);
    //   Store.data = [];
    // }
  },

  renderPreviewHTML(s, container) {
    container.innerHTML = '';
    const reportData = Store.data && Store.data.length > 0 ? Store.data : [];
    const hasData = reportData.length > 0;

    const previewPage = document.createElement('div');
    previewPage.style.cssText =
      'background: white; width: 595px; margin: 0 auto; display: flex; flex-direction: column; min-height: 100%; box-shadow: 0 0 10px rgba(0,0,0,0.1);';

    // Use synced store values
    const isGrouping = Store.grouping.enabled && Store.grouping.field;
    const groupField = Store.grouping.field;

    // 1. REPORT HEADER
    if (s.parts.header) {
      previewPage.appendChild(
        Renderer.renderPart(
          'header',
          s.parts.header,
          hasData ? reportData[0] : null,
          reportData,
        ),
      );
    }

    // 2. DATA BODY & GROUPING
    if (!isGrouping || !hasData) {
      const rows = hasData ? reportData : [{}];
      rows.forEach((row) => {
        if (s.parts.body)
          previewPage.appendChild(
            Renderer.renderPart('body', s.parts.body, hasData ? row : null),
          );
      });
    } else {
      const sorted = [...reportData].sort((a, b) =>
        String(a[groupField] || '').localeCompare(String(b[groupField] || '')),
      );
      let lastGroupVal = null;
      let groupRows = [];

      sorted.forEach((row, idx) => {
        const currentGroupVal = row[groupField];

        if (lastGroupVal !== null && currentGroupVal !== lastGroupVal) {
          if (s.parts['group-footer']) {
            previewPage.appendChild(
              Renderer.renderPart(
                'group-footer',
                s.parts['group-footer'],
                sorted[idx - 1],
                groupRows,
              ),
            );
          }
          groupRows = [];
        }

        if (currentGroupVal !== lastGroupVal && s.parts['group-header']) {
          const currentGroupBucket = sorted.filter(
            (r) => r[groupField] === currentGroupVal,
          );
          previewPage.appendChild(
            Renderer.renderPart(
              'group-header',
              s.parts['group-header'],
              row,
              currentGroupBucket,
            ),
          );
        }

        if (s.parts.body) {
          previewPage.appendChild(
            Renderer.renderPart('body', s.parts.body, row),
          );
        }

        groupRows.push(row);
        lastGroupVal = currentGroupVal;

        if (idx === sorted.length - 1 && s.parts['group-footer']) {
          previewPage.appendChild(
            Renderer.renderPart(
              'group-footer',
              s.parts['group-footer'],
              row,
              groupRows,
            ),
          );
        }
      });
    }

    // 3. REPORT FOOTER
    if (s.parts.footer) {
      previewPage.appendChild(
        Renderer.renderPart(
          'footer',
          s.parts.footer,
          hasData ? reportData[reportData.length - 1] : null,
          reportData,
        ),
      );
    }
    container.appendChild(previewPage);
  },

  selectElement(el, e) {
    if (e) e.stopPropagation();

    if (Store.selectedElement) {
      Store.selectedElement.classList.remove('selected');
      Store.selectedElement.style.outline = '';
    }
    Store.selectedElement = el;
    el.classList.add('selected');
    el.style.outline = '2px dashed red';

    // Sync toolbar when an element is selected
    this.syncFormattingToolbar(el);
  },
  setupKeyboardListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' && Store.selectedElement) {
        Store.selectedElement.remove();
        Store.selectedElement = null;
      }
    });
  },

  setupDropZones() {
    document.querySelectorAll('.part').forEach((p) => {
      p.ondragover = (e) => e.preventDefault();
      p.ondrop = (e) => {
        e.preventDefault();
        const rect = p.getBoundingClientRect();
        Renderer.createCanvasElement(p, {
          x: Math.round(e.clientX - rect.left - 75),
          y: Math.round(e.clientY - rect.top - 11),
          type: e.dataTransfer.getData('type'),
          key: e.dataTransfer.getData('key'),
          function: e.dataTransfer.getData('function'),
        });
      };
    });
    document.querySelectorAll('.tool-item').forEach((item) => {
      item.ondragstart = (e) => {
        e.dataTransfer.setData('type', item.dataset.type);
        if (item.dataset.key) e.dataTransfer.setData('key', item.dataset.key);
        if (item.dataset.function)
          e.dataTransfer.setData('function', item.dataset.function);
      };
    });
  },
  setupPartResizing() {
    interact('.part').resizable({
      edges: { bottom: true },
      listeners: {
        move(e) {
          e.target.style.height = e.rect.height + 'px';
        },
      },
    });
    interact('.canvas-element').resizable({
      edges: { left: true, right: true, bottom: true, top: true },
      listeners: {
        move(e) {
          const t = e.target;
          let x = (parseFloat(t.dataset.x) || 0) + e.deltaRect.left;
          let y = (parseFloat(t.dataset.y) || 0) + e.deltaRect.top;
          Object.assign(t.style, {
            width: e.rect.width + 'px',
            height: e.rect.height + 'px',
            transform: `translate(${x}px,${y}px)`,
          });
          Object.assign(t.dataset, { x, y });
        },
      },
    });
    interact('.drag-handle').draggable({
      listeners: {
        start(e) {
          const el = e.target.parentElement;
          const r = el.getBoundingClientRect();
          el._dragData = {
            startParent: el.parentElement,
            px: r.left,
            py: r.top,
            w: r.width,
            h: r.height,
          };
          document.body.appendChild(el);
          Object.assign(el.style, {
            position: 'fixed',
            left: r.left + 'px',
            top: r.top + 'px',
            transform: 'none',
            zIndex: 1000,
          });
        },
        move(e) {
          const el = e.target.parentElement;
          el._dragData.px += e.dx;
          el._dragData.py += e.dy;
          el.style.left = el._dragData.px + 'px';
          el.style.top = el._dragData.py + 'px';
        },
        end(e) {
          const el = e.target.parentElement;
          const cx = el._dragData.px + el._dragData.w / 2;
          const cy = el._dragData.py + el._dragData.h / 2;
          const targetPart =
            ['header', 'group-header', 'body', 'group-footer', 'footer']
              .map((id) => document.getElementById('part-' + id))
              .find((p) => {
                if (!p || p.style.display === 'none') return false;
                const r = p.getBoundingClientRect();
                return (
                  cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
                );
              }) || el._dragData.startParent;

          const tr = targetPart.getBoundingClientRect();
          const nx = Math.round(cx - tr.left - el._dragData.w / 2);
          const ny = Math.round(cy - tr.top - el._dragData.h / 2);
          targetPart.appendChild(el);
          Object.assign(el.style, {
            position: 'absolute',
            left: '0',
            top: '0',
            transform: `translate(${nx}px,${ny}px)`,
            zIndex: '',
          });
          Object.assign(el.dataset, { x: nx, y: ny });
        },
      },
    });
  },

  // Update the toolbar UI to reflect an element's formatting
  syncFormattingToolbar(el) {
    const target = el || Store.selectedElement;
    const c = target?.querySelector('.element-content');
    const fsSelect = document.getElementById('format-fontsize');
    const bBtn = document.getElementById('format-bold');
    const iBtn = document.getElementById('format-italic');
    const uBtn = document.getElementById('format-underline');

    if (!target || !c) {
      if (fsSelect) fsSelect.value = '14';
      if (bBtn) bBtn.classList.remove('active');
      if (iBtn) iBtn.classList.remove('active');
      if (uBtn) uBtn.classList.remove('active');
      return;
    }

    const fs = c.style.fontSize
      ? parseInt(c.style.fontSize)
      : target.style.fontSize
        ? parseInt(target.style.fontSize)
        : target.dataset.fontSize
          ? parseInt(target.dataset.fontSize)
          : 14;
    const hasBoldTag = !!c.querySelector('b,strong');
    const hasItalicTag = !!c.querySelector('i,em');
    const hasUnderlineTag = !!c.querySelector('u');

    const bold =
      (c.style.fontWeight || '') === 'bold' ||
      (target.style.fontWeight || '') === 'bold' ||
      target.dataset.bold === '1' ||
      hasBoldTag;
    const italic =
      (c.style.fontStyle || '') === 'italic' ||
      (target.style.fontStyle || '') === 'italic' ||
      target.dataset.italic === '1' ||
      hasItalicTag;
    const underline =
      (c.style.textDecoration || '') === 'underline' ||
      (target.style.textDecoration || '') === 'underline' ||
      target.dataset.underline === '1' ||
      hasUnderlineTag;

    if (fsSelect) fsSelect.value = String(fs);
    if (bBtn) bBtn.classList.toggle('active', !!bold);
    if (iBtn) iBtn.classList.toggle('active', !!italic);
    if (uBtn) uBtn.classList.toggle('active', !!underline);
  },

  // Apply formatting to an element (updates content style, element style and dataset)
  applyFormattingToElement(el, { fontSize, bold, italic, underline }) {
    if (!el) return;
    const c = el.querySelector('.element-content');
    if (!c) return;

    if (typeof fontSize !== 'undefined') {
      c.style.fontSize = fontSize ? fontSize + 'px' : '';
      el.dataset.fontSize = fontSize ? String(fontSize) : '';
      el.style.fontSize = c.style.fontSize;
    }
    if (typeof bold !== 'undefined') {
      if (bold) {
        c.style.fontWeight = 'bold';
        el.dataset.bold = '1';
        el.style.fontWeight = 'bold';
      } else {
        c.style.fontWeight = '';
        el.dataset.bold = '';
        el.style.fontWeight = '';
      }
    }
    if (typeof italic !== 'undefined') {
      if (italic) {
        c.style.fontStyle = 'italic';
        el.dataset.italic = '1';
        el.style.fontStyle = 'italic';
      } else {
        c.style.fontStyle = '';
        el.dataset.italic = '';
        el.style.fontStyle = '';
      }
    }
    if (typeof underline !== 'undefined') {
      if (underline) {
        c.style.textDecoration = 'underline';
        el.dataset.underline = '1';
        el.style.textDecoration = 'underline';
      } else {
        c.style.textDecoration = '';
        el.dataset.underline = '';
        el.style.textDecoration = '';
      }
    }

    this.syncFormattingToolbar(el);
  },

  setupFormattingBar() {
    const fs = document.getElementById('format-fontsize');
    if (fs)
      fs.onchange = (e) => {
        if (!Store.selectedElement) return alert('Select an element first');
        const size = parseInt(e.target.value);
        this.applyFormattingToElement(Store.selectedElement, {
          fontSize: size,
        });
      };
    ['format-bold', 'format-italic', 'format-underline'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn)
        btn.onclick = () => {
          if (!Store.selectedElement) return;
          const c = Store.selectedElement.querySelector('.element-content');
          if (id.includes('bold')) {
            const cur =
              (c.style.fontWeight ||
                Store.selectedElement.style.fontWeight ||
                '') === 'bold' || Store.selectedElement.dataset.bold === '1';
            this.applyFormattingToElement(Store.selectedElement, {
              bold: !cur,
            });
          }
          if (id.includes('italic')) {
            const cur =
              (c.style.fontStyle ||
                Store.selectedElement.style.fontStyle ||
                '') === 'italic' ||
              Store.selectedElement.dataset.italic === '1';
            this.applyFormattingToElement(Store.selectedElement, {
              italic: !cur,
            });
          }
          if (id.includes('underline')) {
            const cur =
              (c.style.textDecoration ||
                Store.selectedElement.style.textDecoration ||
                '') === 'underline' ||
              Store.selectedElement.dataset.underline === '1';
            this.applyFormattingToElement(Store.selectedElement, {
              underline: !cur,
            });
          }
        };
    });
  },

  //utility functions
  saveSchema() {
    const schema = ReportEngine.getSchema();
    const blob = new Blob([JSON.stringify(schema, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'report_layout_design.json';
    a.click();
    URL.revokeObjectURL(a.href);
  },
  clearCanvas() {
    if (!confirm('Are you sure you want to clear the entire layout?')) return;
    ['header', 'group-header', 'body', 'group-footer', 'footer'].forEach(
      (name) => {
        const partEl = document.getElementById('part-' + name);
        if (partEl) {
          partEl
            .querySelectorAll('.canvas-element')
            .forEach((el) => el.remove());
          partEl.style.height = name === 'body' ? '60px' : '60px';
        }
      },
    );
    ['keep-header', 'keep-body', 'keep-footer', 'keep-group'].forEach((id) => {
      const cb = document.getElementById(id);
      if (cb) cb.checked = id === 'keep-body';
    });
    const sel = document.getElementById('group-by-field');
    if (sel) {
      sel.value = '';
      sel.style.display = 'none';
    }
    this.syncGroupingState();

    // 5. Update UI Visibility
    this.setupPartToggles();
    document
      .querySelectorAll('#toolbox input[type="checkbox"]')
      .forEach((cb) => {
        cb.dispatchEvent(new Event('change'));
      });
  },

  // main loader function for creation of canva screen based on JSON structure
  loadFromPrompt(jsonData) {
    let raw = jsonData || prompt('Paste Report Schema JSON:');
    if (!raw) return;

    let schema;
    try {
      schema = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      alert('Invalid JSON');
      return;
    }

    /* ---------- MAPPINGS ---------- */
    const partToCheckbox = {
      header: 'keep-header',
      body: 'keep-body',
      footer: 'keep-footer',
      'group-header': 'keep-group-header',
      'group-footer': 'keep-group-footer',
    };

    const allParts = Object.keys(partToCheckbox);

    /* ---------- RESET UI ---------- */
    allParts.forEach((p) => {
      const partEl = document.getElementById('part-' + p);
      if (partEl) {
        partEl.innerHTML = '<div class="resize-handle"></div>';
        partEl.style.display = 'none';
      }

      const cb = document.getElementById(partToCheckbox[p]);
      if (cb) cb.checked = false;
    });

    /* ---------- GROUP STATE ---------- */
    const groupCB = document.getElementById('keep-group');
    const sel = document.getElementById('group-by-field');

    groupCB.checked = !!schema.grouping?.enabled;
    sel.value = schema.grouping?.field || '';

    Store.grouping.enabled = !!schema.grouping?.enabled;
    Store.grouping.field = schema.grouping?.field || null;

    /* ---------- RESTORE PARTS ---------- */

    Object.entries(schema.parts || {}).forEach(([key, part]) => {
      const partEl = document.getElementById('part-' + key);
      const cbId = partToCheckbox[key];
      const cb = document.getElementById(cbId);

      if (!partEl || !cb) return;

      cb.checked = true;
      partEl.style.height = (part.height || 60) + 'px';

      // Non-group parts are ALWAYS visible
      if (!key.startsWith('group-')) {
        partEl.style.display = 'block';
      }

      // Restore elements
      (part.elements || []).forEach((cfg) => {
        Renderer.createCanvasElement(partEl, cfg);
        const created = partEl.querySelector('.canvas-element:last-child');
        if (created) {
          this.applyFormattingToElement(created, {
            fontSize: cfg.fontSize,
            bold: cfg.bold,
            italic: cfg.italic,
            underline: cfg.underline,
          });
        }
      });
    });

    /* ---------- FINAL SYNC ---------- */
    this.syncGroupingState();
  },
  getHTMLContent() {
    const out = document.getElementById('preview-content');

    // 1. Check if a preview exists
    if (!out.innerHTML) {
      return;
    }

    // 2. Wrap the content with the PDF libraries and logic
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Report Export</title> 
</head>
<body>
    <!-- WRAPPER FOR ID TARGETING -->
    <div id="report-container">
        ${out.innerHTML}
    </div>
</body>
</html>`;

    return fullHtml;
  },
  showFullPreviewHTML() {
    const modal = document.getElementById('html-modal');
    const textArea = document.getElementById('html-content');
    const fullHtml = this.getHTMLContent();
    textArea.value = fullHtml;
    modal.style.display = 'flex';
  },
  copyPreviewHTML() {
    const textArea = document.getElementById('html-content');
    textArea.select();
    document.execCommand('copy');
  },
};

Actions.init();
window.app = Actions;

// -------------------------------------------
//  ALL  Fielmaker functions call
// -------------------------------------------
//  load column names/ fieds from filemaker
Actions.loadHeadersFromFM = function (headersJSON) {
  try {
    const arr = JSON.parse(headersJSON);
    Store.headers = Array.isArray(arr) ? arr : Object.values(arr);
    Actions.populateFields();
  } catch (e) {
    list.innerHTML = '<div style="color:red">Failed to load header !</div>';
    console.error(e);
  }
};

//  load all column JSON DATA from external source through filmaker script
Actions.generatePreviewFromFM = function (JSONData) {
  try {
    const out = document.getElementById('preview-content');
    const schema = ReportEngine.getSchema();
    const data = JSON.parse(JSONData);
    Store.data = Array.isArray(data) ? data : data.data;
    Actions.renderPreviewHTML(schema, out);
  } catch (e) {
    out.innerHTML = '<div style="color:red">Error loading full dataset.</div>';
    console.error(e);
  }
};

//  send JSON State to filmaker DB to save state of configuration
window.saveSchemaToFM = function () {
  try {
    const schema = ReportEngine.getSchema();
    const jsonData = JSON.stringify(schema);
    const htmlContent = Actions.getHTMLContent();

    if (htmlContent) {
      const payloadData = {
        jsonData: jsonData,
        htmlData: htmlContent,
      };
      FileMaker.PerformScript('saveJSON', JSON.stringify(payloadData));
    } else {
      alert("Please click 'Preview' first to generate the report content.");
    }
  } catch (e) {
    console.error('saveSchemaToFM error:', e);
  }
};

//  send JSON state data from filemaker to show state of design
window.sendSchemaFromFM = function (jsonString) {
  try {
    Actions.loadFromPrompt(jsonString);
  } catch (e) {
    console.error('error:', e);
  }
};

// expose to FileMaker Web Viewer
window.loadHeadersFromFM = Actions.loadHeadersFromFM;
window.generatePreviewFromFM = Actions.generatePreviewFromFM;
