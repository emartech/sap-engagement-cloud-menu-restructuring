(async function() {
  // ===== DATA LOADING =====
  const VARIANT_FILES = ['as-is','variant-final-progressive','variant-final-asis-flatten','variant-iter-flat','variant-iter-restructured','variant-iter-sections','variant-lt-progressive','variant-b3','variant-d2','variant-f3','variant-cust5','variant-p1','variant-g1','variant-b2','variant-p2','variant-p3','variant-claude','variant-claude2','variant-A1','variant-A2','variant-B','variant-C1','variant-C2','variant-C3','variant-D'];
  const [items, ...variants] = await Promise.all([
    fetch('data/items.json').then(r => r.json()),
    ...VARIANT_FILES.map(f => fetch(`data/${f}.json`).then(r => r.json()))
  ]);

  const itemsMap = {};
  items.forEach(it => { itemsMap[it.id] = it; });
  const variantsMap = {};
  variants.forEach(v => { variantsMap[v.id] = v; });
  const maxUpv = Math.max(...items.map(i => i.upv || 0));

  // Tab-to-variant mapping
  const TAB_MAP = {
    'ux': { '1': 'as-is', '2': 'iter-flat', '3': 'final-asis-flatten', '4': 'final-progressive', '5': 'iter-restructured' },
    'shortlist': {}
  };

  const SUB_LABELS = { 'ux': {}, 'shortlist': {} };

  const ALL_VARIANT_IDS = ['as-is','iter-flat','final-asis-flatten','final-progressive','iter-restructured'];
  const ALL_DECISION_IDS = ALL_VARIANT_IDS;

  // Populate SUB_LABELS from variant names AFTER variantsMap is built
  // Restore saved tab order if available
  const savedTabOrder = JSON.parse(localStorage.getItem('menuDemoTabOrder_ux') || 'null');
  if (savedTabOrder && Array.isArray(savedTabOrder)) {
    const savedSet = new Set(savedTabOrder);
    const currentIds = Object.values(TAB_MAP['ux']);
    const newIds = currentIds.filter(id => !savedSet.has(id));
    const orderedIds = [...savedTabOrder.filter(id => currentIds.includes(id)), ...newIds];
    TAB_MAP['ux'] = {};
    orderedIds.forEach((id, i) => { TAB_MAP['ux'][String(i+1)] = id; });
  }
  Object.entries(TAB_MAP['ux']).forEach(([k, vid]) => {
    const v = variantsMap[vid];
    SUB_LABELS['ux'][k] = v ? v.name : vid;
  });

  // ===== AUTOSAVE =====
  async function saveToServer(key, data) {
    try {
      await fetch(`/save/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (e) {
      // Server not available – localStorage only
    }
  }

  // ===== STATE =====
  // Load from server-saved files first, fall back to localStorage
  async function loadSaved(key, lsKey) {
    try {
      const r = await fetch(`data/${key}-decisions.json`);
      if (r.ok) return await r.json();
    } catch (e) {}
    return JSON.parse(localStorage.getItem(lsKey) || '{}');
  }

  const [savedNaming, savedFeedback] = await Promise.all([
    loadSaved('naming', 'menuDemoNaming'),
    loadSaved('feedback', 'menuDemoFeedback')
  ]);

  let state = {
    mainTab: 'ux',
    sub: '1',
    selectedId: null,
    viewMode: 'menu', // 'menu' | 'compare' | 'custom'
    editingVariantId: null,
    editOriginal: null,
    custom: JSON.parse(localStorage.getItem('menuDemoCustom') || 'null'),
    customSource: 'f3',
    compareColumns: ['iter-flat','final-asis-flatten','final-progressive'],
    expanded: new Set(),
    feedback: savedFeedback,
    naming: savedNaming,
    decisionFilter: 'all'
  };

  state.decisions = JSON.parse(localStorage.getItem('menuDemoDecisions') || '{}');

  state.starred = new Set(JSON.parse(localStorage.getItem('menuDemoStarred') || '["final-progressive","final-asis-flatten"]'));
  // Clean stale starred IDs not in current variants
  const validVids = new Set(Object.values(TAB_MAP['ux']));
  [...state.starred].forEach(vid => { if (!validVids.has(vid)) state.starred.delete(vid); });

  function currentVariantId() {
    return TAB_MAP[state.mainTab]?.[state.sub] || 'as-is';
  }
  function currentVariant() {
    return variantsMap[currentVariantId()];
  }

  // ===== FEEDBACK =====
  function saveFeedback() {
    localStorage.setItem('menuDemoFeedback', JSON.stringify(state.feedback));
    saveToServer('feedback', state.feedback);
  }
  function getFb(variantId, itemId) {
    return state.feedback[variantId]?.[itemId] || {};
  }
  function setFb(variantId, itemId, key, val) {
    if (!state.feedback[variantId]) state.feedback[variantId] = {};
    if (!state.feedback[variantId][itemId]) state.feedback[variantId][itemId] = {};
    state.feedback[variantId][itemId][key] = val;
    saveFeedback();
  }

  // ===== NAMING =====
  function saveNaming() {
    localStorage.setItem('menuDemoNaming', JSON.stringify(state.naming));
    saveToServer('naming', state.naming);
  }
  function getNaming(itemId) {
    const n = state.naming[itemId] || { selected: null, customs: [], note: '', status: 'pending' };
    // Migrate old 'custom' string to 'customs' array
    if (n.custom && !n.customs) { n.customs = [n.custom]; delete n.custom; }
    if (!n.customs) n.customs = [];
    return n;
  }
  function setNaming(itemId, key, val) {
    if (!state.naming[itemId]) state.naming[itemId] = { selected: null, customs: [], note: '', status: 'pending' };
    if (!state.naming[itemId].customs) state.naming[itemId].customs = [];
    state.naming[itemId][key] = val;
    saveNaming();
  }

  // Build candidates for each item from all name sources
  function buildCandidates(itemId) {
    const item = itemsMap[itemId];
    if (!item) return {};
    const flat = variantsMap['iter-flat'];
    const sections = variantsMap['iter-sections'];
    const restructured = variantsMap['iter-restructured'];
    const progressive = variantsMap['lt-progressive'];

    const original = item.name;
    const tilly = (item.tillyName && item.tillyName !== '–' && item.tillyName !== '???' && !item.tillyName.startsWith('Remove') && !item.tillyName.startsWith('Replaced')) ? item.tillyName : null;
    const flatName = flat?.renames?.[itemId] || null;
    const sectionsName = sections?.renames?.[itemId] || null;
    const restructuredName = restructured?.renames?.[itemId] || null;
    const progressiveName = progressive?.renames?.[itemId] || null;

    return { original, tilly, flat: flatName, sections: sectionsName, restructured: restructuredName, progressive: progressiveName };
  }

  function uniqueCandidateValues(cands) {
    const vals = new Set();
    Object.values(cands).forEach(v => { if (v) vals.add(v); });
    return vals;
  }

  // ===== CHANGE DETECTION =====
  function getItemParentInVariant(itemId, variant) {
    if (variant.removed?.includes(itemId)) return null;
    if (variant.links?.includes(itemId)) return '(top-level link)';
    for (const g of (variant.groups || [])) {
      if (g.items && g.items.includes(itemId)) return g.name;
      if (g.subgroups) {
        for (const sg of g.subgroups) {
          if (sg.items.includes(itemId)) return g.name;
        }
      }
    }
    return null;
  }

  function getItemChanges(itemId, variant) {
    const item = itemsMap[itemId];
    if (!item) return [];
    const changes = [];
    const flags = item.flags || [];
    if (flags.includes('new')) changes.push('new');
    if (flags.includes('custom')) changes.push('custom');
    if (variant.removed?.includes(itemId)) { changes.push('removed'); return changes; }
    if (variant.id !== 'as-is' && flags.includes('removed')) { changes.push('removed'); return changes; }
    if (variant.renames?.[itemId]) changes.push('renamed');
    const curParent = getItemParentInVariant(itemId, variant);
    const asIsParent = item.asIsParent;
    if (curParent && asIsParent && curParent !== asIsParent && curParent !== '(top-level link)') changes.push('moved');
    if (item.type === 'link' && variant.id !== 'as-is' && item.asIsParent !== '(top-level link)') {
      if (!changes.includes('moved')) changes.push('moved');
    }
    return changes;
  }

  function getDisplayName(itemId, variant) {
    return variant.renames?.[itemId] || itemsMap[itemId]?.name || itemId;
  }

  // ===== DOM REFS =====
  const sidebar = document.getElementById('sidebar');
  const detailPanel = document.getElementById('detailPanel');
  const variantDesc = document.getElementById('variantDesc');
  const subToggle = document.getElementById('variantTabs');
  const mainContent = document.getElementById('mainContent');
  const compareView = document.getElementById('compareView');
  const customView = document.getElementById('customView');
  const decisionsView = document.getElementById('decisionsView');

  // ===== TAB HANDLING =====
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.mainTab = tab.dataset.tab;
      state.sub = '1';
      state.selectedId = null;
      state.expanded.clear();
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      updateSubToggle();
      updateViewVisibility();
      if (state.mainTab === 'decisions') {
        renderDecisions();
      } else {
        render();
        if (state.viewMode === 'compare') renderCompare();
      }
    });
  });

  // ===== SUB TOGGLE =====

  function updateSubToggle() {
    const tab = state.mainTab;

    if (tab === 'decisions') {
      subToggle.style.display = 'flex';
      subToggle.innerHTML = '<span class="compare-view-label">Decision Tracker</span>';
      return;
    }

    if (tab === 'shortlist') {
      // Build from starred variants
      const starredArr = [...state.starred];
      if (starredArr.length === 0) {
        subToggle.style.display = 'none';
        subToggle.innerHTML = '<span style="font-size:12px;color:#8D9094">No variants starred. Star variants in UX Versions.</span>';
        subToggle.style.display = 'flex';
        return;
      }
      // Check if current sub is valid
      if (!starredArr.includes(TAB_MAP['shortlist']?.[state.sub])) {
        state.sub = '1';
      }
      // Build dynamic TAB_MAP and SUB_LABELS for shortlist
      TAB_MAP['shortlist'] = {};
      SUB_LABELS['shortlist'] = {};
      starredArr.forEach((vid, i) => {
        const key = String(i + 1);
        TAB_MAP['shortlist'][key] = vid;
        const v = variantsMap[vid];
        SUB_LABELS['shortlist'][key] = v ? v.name : vid.toUpperCase();
      });

      subToggle.style.display = 'flex';

      if (state.viewMode === 'compare') {
        subToggle.innerHTML = '<span class="compare-view-label">Compare View – Shortlist</span><button class="compare-ctrl-btn" id="compareExpandAll">Expand All</button><button class="compare-ctrl-btn" id="compareCollapseAll">Collapse All</button>';
        return;
      }

      subToggle.innerHTML = starredArr.map((vid, i) => {
        const key = String(i + 1);
        const v = variantsMap[vid];
        const label = v ? v.name : vid.toUpperCase();
        return `<button class="variant-tab${state.sub === key ? ' active' : ''}" data-sub="${key}">${label}</button>`;
      }).join('');

    } else if (tab === 'ux') {
      const subs = TAB_MAP['ux'];
      const labels = SUB_LABELS['ux'];
      subToggle.style.display = 'flex';

      if (state.viewMode === 'compare') {
        // Compare mode: replace tabs with label
        subToggle.innerHTML = '<span class="compare-view-label">Compare View</span><button class="compare-ctrl-btn" id="compareExpandAll">Expand All</button><button class="compare-ctrl-btn" id="compareCollapseAll">Collapse All</button>';
        return;
      }

      subToggle.innerHTML = Object.keys(subs).map(k => {
        const vid = subs[k];
        const vr = variantsMap[vid];
        const menuTrigger = vid === 'as-is' ? '' : `<span class="variant-menu-trigger" data-vmenu-vid="${vid}">\u22EF</span>`;
        const tierBadge = vr?.tier === 'Long-term' ? '<span class="variant-tier-badge">LT</span>' : '';
        return `<button class="variant-tab${state.sub === k ? ' active' : ''}" data-sub="${k}">${tierBadge}${labels[k] || k}${menuTrigger}</button>`;
      }).join('') + '<button class="variant-tab variant-tab-add" id="btnCustomBuilder" title="New Variant">+</button>';

      // Show archived count link if any
      const archived = JSON.parse(localStorage.getItem('menuDemoArchived') || '[]');
      if (archived.length > 0) {
        subToggle.innerHTML += `<span class="variant-tab-archived" id="showArchived">Archived (${archived.length})</span>`;
      }
    } else {
      subToggle.style.display = 'none';
      subToggle.innerHTML = '';
      return;
    }

    // Attach sub-button click handlers
    subToggle.querySelectorAll('.variant-tab').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (e.target.closest('.variant-menu-trigger')) return; // handled separately
        state.sub = btn.dataset.sub;
        state.selectedId = null;
        render();
        updateSubToggle();
        if (state.viewMode === 'compare') renderCompare();
      });
    });

    // Attach variant context menu triggers
    subToggle.querySelectorAll('.variant-menu-trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const vid = trigger.dataset.vmenuVid;
        showVariantMenu(trigger, vid);
      });
    });

    // Attach archived link handler
    const archivedLink = document.getElementById('showArchived');
    if (archivedLink) {
      archivedLink.addEventListener('click', () => {
        const archived = JSON.parse(localStorage.getItem('menuDemoArchived') || '[]');
        if (archived.length === 0) return;
        const msg = archived.map(a => `${a.name} (archived ${new Date(a.timestamp).toLocaleDateString()})`).join('\n');
        const restore = prompt('Archived variants:\n' + msg + '\n\nType a variant name to restore, or Cancel:');
        if (!restore) return;
        const found = archived.find(a => a.name.toLowerCase() === restore.toLowerCase() || a.id === restore);
        if (found) {
          // Restore: remove from archived, re-add to TAB_MAP
          const remaining = archived.filter(a => a.id !== found.id);
          localStorage.setItem('menuDemoArchived', JSON.stringify(remaining));
          if (variantsMap[found.id]) {
            const nextKey = String(Object.keys(TAB_MAP['ux']).length + 1);
            TAB_MAP['ux'][nextKey] = found.id;
            SUB_LABELS['ux'][nextKey] = variantsMap[found.id].name;
          }
          updateSubToggle();
        } else {
          alert('Variant not found in archive.');
        }
      });
    }

    // Attach + New Variant button handler
    const addBtn = subToggle.querySelector('.variant-tab-add');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.editingVariantId = null;
        state.editOriginal = null;
        state.customSource = currentVariantId();
        customOverlay.style.display = 'flex';
        customOverlay.classList.add('active');
        renderCustom();
      });
    }

    // Tab drag-and-drop reordering (UX and Phase1 tabs)
    if (tab === 'ux') {
      subToggle.querySelectorAll('.variant-tab[data-sub]').forEach(tabEl => {
        tabEl.setAttribute('draggable', 'true');
        tabEl.addEventListener('dragstart', (e) => {
          if (e.target.closest('.variant-menu-trigger')) { e.preventDefault(); return; }
          e.dataTransfer.setData('text/plain', tabEl.dataset.sub);
          tabEl.style.opacity = '0.4';
        });
        tabEl.addEventListener('dragend', () => { tabEl.style.opacity = ''; });
        tabEl.addEventListener('dragover', (e) => {
          e.preventDefault();
          tabEl.style.borderBottomColor = '#0070F2';
        });
        tabEl.addEventListener('dragleave', () => {
          tabEl.style.borderBottomColor = tabEl.classList.contains('active') ? '#0070F2' : 'transparent';
        });
        tabEl.addEventListener('drop', (e) => {
          e.preventDefault();
          tabEl.style.borderBottomColor = tabEl.classList.contains('active') ? '#0070F2' : 'transparent';
          const fromKey = e.dataTransfer.getData('text/plain');
          const toKey = tabEl.dataset.sub;
          if (fromKey === toKey) return;
          const curTab = state.mainTab;
          const entries = Object.entries(TAB_MAP[curTab]).sort((a,b) => parseInt(a[0]) - parseInt(b[0]));
          const ids = entries.map(e => e[1]);
          const fromIdx = ids.indexOf(TAB_MAP[curTab][fromKey]);
          const toIdx = ids.indexOf(TAB_MAP[curTab][toKey]);
          if (fromIdx < 0 || toIdx < 0) return;
          const [moved] = ids.splice(fromIdx, 1);
          ids.splice(toIdx, 0, moved);
          TAB_MAP[curTab] = {};
          SUB_LABELS[curTab] = {};
          ids.forEach((id, i) => {
            const k = String(i + 1);
            TAB_MAP[curTab][k] = id;
            const vr = variantsMap[id];
            SUB_LABELS[curTab][k] = vr ? vr.name : id;
          });
          const currentVid = currentVariantId();
          for (const [k, id] of Object.entries(TAB_MAP[curTab])) {
            if (id === currentVid) { state.sub = k; break; }
          }
          updateSubToggle();
          localStorage.setItem('menuDemoTabOrder_' + curTab, JSON.stringify(ids));
        });
      });
    }
  }
  function setViewMode(mode) {
    state.viewMode = mode;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
    updateViewVisibility();
    updateSubToggle(); // refresh tabs for compare mode label swap
    if (mode === 'compare') renderCompare();
  }

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });

  // Custom Builder – full screen overlay
  const customOverlay = document.getElementById('customOverlay');
  const detailsPanel = document.getElementById('variantDetailsPanel');
  // Note: btnCustomBuilder click is handled in updateSubToggle (dynamic + button)
  // Note: Edit is now in the context menu (handleVariantAction)

  // Details panel toggle
  document.getElementById('btnVariantDetails').addEventListener('click', () => {
    if (detailsPanel.classList.contains('active')) {
      detailsPanel.classList.remove('active');
      detailsPanel.style.display = 'none';
    } else {
      renderVariantDetails();
      detailsPanel.classList.add('active');
      detailsPanel.style.display = 'block';
    }
  });

  function getItemParentInV(vid, itemId) {
    const v = variantsMap[vid];
    if (!v) return null;
    if (v.links?.includes(itemId)) return '(link)';
    for (const g of (v.groups || [])) {
      const gItems = getAllGroupItemIds(g);
      if (gItems.includes(itemId)) return g.name;
    }
    return null;
  }

  // ===== IA SCORING HELPERS =====
  function getGroupSiblings(vid, itemId) {
    const v = variantsMap[vid];
    if (!v) return new Set();
    for (const g of (v.groups || [])) {
      const gItems = new Set(getAllGroupItemIds(g));
      if (gItems.has(itemId)) return gItems;
    }
    return new Set();
  }

  function calcJaccardSimilarity(vid1, vid2) {
    const allItemIds = items.filter(it => it.type !== 'group').map(it => it.id);
    let scores = [];
    allItemIds.forEach(itemId => {
      const sibs1 = getGroupSiblings(vid1, itemId);
      const sibs2 = getGroupSiblings(vid2, itemId);
      if (!sibs1.size && !sibs2.size) { scores.push(1); return; }
      if (!sibs1.size || !sibs2.size) { scores.push(0); return; }
      const intersection = [...sibs1].filter(id => sibs2.has(id)).length;
      const union = new Set([...sibs1, ...sibs2]).size;
      scores.push(union > 0 ? intersection / union : 1);
    });
    return scores.length > 0 ? Math.round(scores.reduce((a,b) => a+b, 0) / scores.length * 100) : 100;
  }

  function calcNamingSimilarity(vid1, vid2) {
    const v1 = variantsMap[vid1], v2 = variantsMap[vid2];
    let same = 0, total = 0;
    items.forEach(it => {
      if (it.type === 'group') return;
      const n1 = v1?.renames?.[it.id] || it.name;
      const n2 = v2?.renames?.[it.id] || it.name;
      total++; if (n1 === n2) same++;
    });
    return total > 0 ? Math.round(same / total * 100) : 100;
  }

  function calcItemRetention(vid) {
    const v = variantsMap[vid];
    const asIs = variantsMap['as-is'];
    if (!v || !asIs) return 100;
    const asIsItems = new Set();
    (asIs.groups || []).forEach(g => getAllGroupItemIds(g).forEach(id => asIsItems.add(id)));
    const vItems = new Set();
    (v.groups || []).forEach(g => getAllGroupItemIds(g).forEach(id => vItems.add(id)));
    (v.links || []).filter(id => id !== 'home' && id !== 'automation').forEach(id => vItems.add(id));
    const kept = [...asIsItems].filter(id => vItems.has(id) && !v.removed?.includes(id)).length;
    return asIsItems.size > 0 ? Math.round(kept / asIsItems.size * 100) : 100;
  }

  function renderVariantDetails() {
    const v = currentVariant();
    const vid = currentVariantId();
    if (!v || vid === 'as-is') {
      detailsPanel.innerHTML = '<div style="padding:12px;font-size:12px;color:#6A6D70">This is the baseline As-Is menu structure. All variants are compared against it.</div>';
      return;
    }

    const groupSizes = (v.groups || []).map(g => ({ name: g.name, size: getAllGroupItemIds(g).length }));
    const topLevelCount = (v.links?.length || 0) + (v.groups?.length || 0);
    const maxGrp = Math.max(...groupSizes.map(g => g.size), 0);
    const minGrp = Math.min(...groupSizes.filter(g => g.size > 0).map(g => g.size), 99);
    const renames = Object.keys(v.renames || {}).length;
    const removed = (v.removed || []).length;
    const retention = calcItemRetention(vid);
    const grpSim = calcJaccardSimilarity('as-is', vid);
    const namSim = calcNamingSimilarity('as-is', vid);

    // Structural changes
    const asIsGroups = (variantsMap['as-is']?.groups || []);
    const varGroups = (v.groups || []);
    const groupChanges = [];
    const matchedAsIs = new Set();
    varGroups.forEach(vg => {
      const vgItems = new Set(getAllGroupItemIds(vg));
      let bestMatch = null, bestJac = 0;
      asIsGroups.forEach(ag => {
        const agItems = new Set(getAllGroupItemIds(ag));
        const inter = [...vgItems].filter(id => agItems.has(id)).length;
        const union = new Set([...vgItems, ...agItems]).size;
        const jac = union > 0 ? inter / union : 0;
        if (jac > bestJac) { bestJac = jac; bestMatch = ag; }
      });
      if (bestMatch && bestJac > 0.4) {
        matchedAsIs.add(bestMatch.name);
        if (bestMatch.name !== vg.name) groupChanges.push({ type: 'renamed', from: bestMatch.name, to: vg.name });
      } else {
        groupChanges.push({ type: 'new', name: vg.name, size: getAllGroupItemIds(vg).length });
      }
    });
    asIsGroups.forEach(ag => {
      if (!matchedAsIs.has(ag.name)) groupChanges.push({ type: 'split', name: ag.name });
    });

    const movedItems = [];
    items.forEach(it => {
      if (it.type === 'group') return;
      const s1 = getGroupSiblings('as-is', it.id);
      const s2 = getGroupSiblings(vid, it.id);
      if (!s1.size || !s2.size) return;
      const inter = [...s1].filter(x => s2.has(x)).length;
      const union = new Set([...s1, ...s2]).size;
      if (union > 0 && inter / union < 0.5) {
        const from = getItemParentInV('as-is', it.id) || '?';
        const to = getItemParentInV(vid, it.id) || '?';
        if (from !== to) movedItems.push({ name: v.renames?.[it.id] || it.name, from, to });
      }
    });

    // Similar variants – compare within current tab
    const simPool = ALL_VARIANT_IDS;
    const sims = [];
    simPool.forEach(oid => {
      if (oid === vid || oid === 'as-is') return;
      const ov = variantsMap[oid];
      if (!ov) return;
      const gs = calcJaccardSimilarity(vid, oid);
      const ns = calcNamingSimilarity(vid, oid);
      const combined = Math.round((gs + ns) / 2);
      sims.push({ vid: oid, label: ov.id && ov.id !== oid ? ov.id + ' – ' + ov.name : ov.name, combined: combined, grouping: gs, naming: ns });
    });
    sims.sort((a, b) => b.combined - a.combined);

    // === IA RATING ===
    const sizes = groupSizes.map(g => g.size);
    const avgSize = sizes.length > 0 ? sizes.reduce((a,b) => a+b, 0) / sizes.length : 0;
    const stdDev = sizes.length > 0 ? Math.sqrt(sizes.reduce((a,s) => a + (s - avgSize) ** 2, 0) / sizes.length) : 0;
    const balanceScore = Math.max(0, Math.round(100 - stdDev * 6));
    const hasSeparators = (v.entryOrder || []).some(e => e.type === 'separator');
    const hasOversized = sizes.some(s => s > 12);
    // Separators HELP: they reduce cognitive load. Flat with large groups is WORSE.
    const depthScore = hasSeparators ? 90 : (hasOversized ? 65 : 80);
    const totalItems = items.filter(it => it.type !== 'group').length;
    const namingScore = Math.min(100, Math.round(50 + (renames / totalItems) * 150));
    const completenessScore = retention;
    const iaRating = Math.round((balanceScore * 0.3 + depthScore * 0.25 + namingScore * 0.2 + completenessScore * 0.25));
    const ratingColor = iaRating >= 80 ? '#188038' : iaRating >= 60 ? '#E37400' : '#D93025';
    const ratingBg = iaRating >= 80 ? '#E6F4EA' : iaRating >= 60 ? '#FEF7E0' : '#FFF0F0';

    // IA tooltip reasoning
    const balanceReason = balanceScore >= 85 ? 'Well-balanced group sizes' : balanceScore >= 60 ? 'Some groups are much larger than others' : 'Very uneven group sizes';
    const depthReason = hasSeparators ? 'Separators help scan long menus' : (hasOversized ? 'Large groups without separators hurt scannability' : 'Flat structure, manageable group sizes');
    const namingReason = renames > 10 ? 'Many intentional renames for clarity' : renames > 3 ? 'Some renames improve naming' : 'Mostly original names';
    const complReason = completenessScore === 100 ? 'All menu items kept' : completenessScore >= 90 ? 'Most items kept (' + removed + ' removed)' : removed + ' items removed';
    const iaTooltip = `IA Score: ${iaRating}/100\n\nBalance (${balanceScore}): ${balanceReason}\nStructure (${depthScore}): ${depthReason}\nNaming (${namingScore}): ${namingReason}\nCompleteness (${completenessScore}): ${complReason}`;

    // === RENDER ===
    let html = '<div class="vd-panel">';

    // Row 1: Header
    html += '<div class="vd-header">';
    html += '<div class="vd-header-left">';
    if (v.author) html += `<span class="vd-author">${esc(v.author)}</span>`;
    if (v.tier) html += `<span class="vd-tier ${v.tier === 'Long-term' ? 'vd-tier-lt' : 'vd-tier-iter'}">${esc(v.tier)}</span>`;
    html += `<span class="vd-title">${esc(v.name)}</span>`;
    html += '</div>';
    html += `<span class="vd-ia-badge" style="color:${ratingColor};background:${ratingBg}" title="${esc(iaTooltip)}">IA ${iaRating}</span>`;
    html += '</div>';

    if (v.mergeNote) {
      html += `<div class="vd-merge-note">${esc(v.mergeNote)}</div>`;
    }

    // Row 2: Three-column layout
    html += '<div class="vd-body">';

    // Column 1: Metrics
    html += '<div class="vd-col vd-col-metrics">';
    html += '<div class="vd-col-title">Compared to As-Is</div>';
    const retCls = retention === 100 ? 'vd-metric-good' : retention >= 90 ? '' : 'vd-metric-warn';
    const remCls = removed > 0 ? 'vd-metric-bad' : '';
    html += '<div class="vd-metrics-grid">';
    html += `<div class="vd-metric ${retCls}"><span class="vd-metric-value">${retention}%</span><span class="vd-metric-label">items kept</span></div>`;
    html += `<div class="vd-metric"><span class="vd-metric-value">${namSim}%</span><span class="vd-metric-label">naming</span></div>`;
    html += `<div class="vd-metric"><span class="vd-metric-value">${grpSim}%</span><span class="vd-metric-label">grouping</span></div>`;
    html += `<div class="vd-metric ${remCls}"><span class="vd-metric-value">${removed}</span><span class="vd-metric-label">removed</span></div>`;
    html += '</div>';
    if (removed > 0) {
      const removedNames = (v.removed || []).map(id => v.renames?.[id] || itemsMap[id]?.name || id);
      html += `<div class="vd-removed-list">${removedNames.map(n => esc(n)).join(', ')}</div>`;
    }
    html += '<div class="vd-col-title" style="margin-top:12px">Structure</div>';
    html += '<div class="vd-metrics-grid">';
    html += `<div class="vd-metric"><span class="vd-metric-value">${topLevelCount}</span><span class="vd-metric-label">top-level</span></div>`;
    html += `<div class="vd-metric"><span class="vd-metric-value">${minGrp}</span><span class="vd-metric-label">smallest</span></div>`;
    html += `<div class="vd-metric"><span class="vd-metric-value">${maxGrp}</span><span class="vd-metric-label">largest</span></div>`;
    html += `<div class="vd-metric"><span class="vd-metric-value">${renames}</span><span class="vd-metric-label">renamed</span></div>`;
    html += '</div>';
    html += '</div>';

    // Column 2: Similar versions
    html += '<div class="vd-col vd-col-similar">';
    html += '<div class="vd-col-title">Similar Proposals</div>';
    if (sims.length === 0) {
      html += '<div style="font-size:11px;color:#8D9094">No other variants to compare</div>';
    }
    sims.slice(0, 6).forEach(s => {
      const barW = Math.max(s.combined, 5);
      const barColor = s.combined >= 80 ? '#34A853' : s.combined >= 50 ? '#FBBC04' : '#EA4335';
      const textColor = s.combined >= 80 ? '#188038' : s.combined >= 50 ? '#6A6D70' : '#D93025';
      html += '<div class="vd-sim-row">';
      html += `<span class="vd-sim-pct" style="color:${textColor}">${s.combined}%</span>`;
      html += `<div class="vd-sim-bar"><div style="width:${barW}%;background:${barColor}"></div></div>`;
      html += `<a href="#" class="vd-sim-link" data-sim-vid="${esc(s.vid)}">${esc(s.label)}</a>`;
      html += '</div>';
    });
    html += '</div>';

    // Column 3: Changes
    html += '<div class="vd-col vd-col-changes">';
    const renamedGrps = groupChanges.filter(c => c.type === 'renamed');
    const newGrps = groupChanges.filter(c => c.type === 'new');
    // Only show "split" for groups that actually had multiple items and were broken up, not for single-item groups that became links
    const splits = groupChanges.filter(c => c.type === 'split').filter(c => {
      const ag = asIsGroups.find(g => g.name === c.name);
      return ag && getAllGroupItemIds(ag).length > 1;
    });
    const hasChanges = renamedGrps.length > 0 || newGrps.length > 0 || splits.length > 0 || movedItems.length > 0;

    html += '<div class="vd-col-title">Changes vs As-Is</div>';
    if (!hasChanges) {
      html += '<div style="font-size:11px;color:#8D9094">Same structure as As-Is</div>';
    } else {
      if (renamedGrps.length) {
        renamedGrps.forEach(c => { html += `<div class="vd-change-line"><span class="vd-tag vd-tag-renamed">renamed</span>${esc(c.from)} → ${esc(c.to)}</div>`; });
      }
      if (newGrps.length) {
        newGrps.forEach(c => { html += `<div class="vd-change-line"><span class="vd-tag vd-tag-new">new</span>${esc(c.name)} (${c.size})</div>`; });
      }
      if (splits.length) {
        splits.forEach(c => { html += `<div class="vd-change-line"><span class="vd-tag vd-tag-split">split</span>${esc(c.name)}</div>`; });
      }
      if (movedItems.length) {
        const movePatterns = {};
        movedItems.forEach(m => {
          const key = m.from + '→' + m.to;
          if (!movePatterns[key]) movePatterns[key] = { from: m.from, to: m.to, items: [] };
          movePatterns[key].items.push(m.name);
        });
        html += `<div class="vd-col-title" style="margin-top:8px">Moves (${movedItems.length})</div>`;
        Object.values(movePatterns).sort((a,b) => b.items.length - a.items.length).forEach(p => {
          html += `<div class="vd-move"><span class="vd-move-from">${esc(p.from)}</span> → <span class="vd-move-to">${esc(p.to)}</span> (${p.items.length})</div>`;
        });
      }
    }
    const oversized = groupSizes.filter(g => g.size > 12);
    oversized.forEach(g => { html += `<div class="vd-warn">⚠ ${esc(g.name)}: ${g.size} items</div>`; });
    html += '</div>';

    html += '</div></div>';

    detailsPanel.innerHTML = html;

    // Wire up similar variant links
    detailsPanel.querySelectorAll('.vd-sim-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetVid = link.dataset.simVid;
        const tab = state.mainTab;
        const map = TAB_MAP[tab];
        for (const [k, id] of Object.entries(map)) {
          if (id === targetVid) { state.sub = k; render(); return; }
        }
      });
    });
  }

  function items_map_name(id) {
    return itemsMap[id]?.name || id;
  }
  document.getElementById('customBack').addEventListener('click', () => {
    state.editingVariantId = null;
    state.editOriginal = null;
    customOverlay.style.display = 'none';
    customOverlay.classList.remove('active');
    render();
    if (state.viewMode === 'compare') renderCompare();
  });

  function updateViewVisibility() {
    const isDecisions = state.mainTab === 'decisions';
    mainContent.style.display = (!isDecisions && state.viewMode === 'menu') ? 'flex' : 'none';
    compareView.style.display = (!isDecisions && state.viewMode === 'compare') ? 'flex' : 'none';
    compareView.classList.toggle('active', !isDecisions && state.viewMode === 'compare');
    decisionsView.style.display = isDecisions ? 'flex' : 'none';
    decisionsView.classList.toggle('active', isDecisions);
    const variantBar = document.querySelector('.variant-bar');
    const infoBar = document.querySelector('.info-bar');
    if (isDecisions) {
      if (variantBar) variantBar.style.display = 'none';
      if (infoBar) infoBar.style.display = 'none';
    } else {
      if (variantBar) variantBar.style.display = '';
      if (infoBar) infoBar.style.display = state.viewMode === 'compare' ? 'none' : 'flex';
    }
  }

  // Export / Clear feedback
  document.getElementById('btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.feedback, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'menu-feedback.json'; a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('btnClear').addEventListener('click', () => {
    if (confirm('Clear all feedback? This cannot be undone.')) {
      state.feedback = {};
      saveFeedback();
      render();
    }
    document.getElementById('shellMoreMenu').classList.remove('open');
  });

  // Shell bar ⋯ menu toggle
  document.getElementById('btnShellMore').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('shellMoreMenu').classList.toggle('open');
  });
  document.addEventListener('click', () => {
    document.getElementById('shellMoreMenu').classList.remove('open');
  });

  // Show archived variants
  document.getElementById('btnShowArchived').addEventListener('click', () => {
    document.getElementById('shellMoreMenu').classList.remove('open');
    const archived = Object.keys(variantsMap).filter(vid => {
      const inUx = Object.values(TAB_MAP['ux']).includes(vid);
      return !inUx && vid !== 'as-is';
    });
    if (archived.length === 0) { alert('No archived variants.'); return; }
    const list = archived.map(vid => {
      const v = variantsMap[vid];
      return v ? `${v.id} – ${v.name}${v.author ? ' (' + v.author + ')' : ''}` : vid;
    }).join('\n');
    alert('Archived variants (' + archived.length + '):\n\n' + list);
  });

  // ===== RENDER SIDEBAR =====
  function render() {
    const v = currentVariant();

    variantDesc.textContent = v.subtitle + " – " + v.description;
    const removedCount = (v.removed || []).length;
    if (removedCount > 0) {
      variantDesc.innerHTML = variantDesc.textContent + ` <span style="color:#D93025;font-weight:600">\u26A0 ${removedCount} item${removedCount > 1 ? 's' : ''} removed</span>`;
    }

    // Re-render details panel if it's open (keep it open across variant switches)
    if (detailsPanel.classList.contains('active')) {
      renderVariantDetails();
    }

    renderSidebar(v);
    renderDetail();
  }

  function buildEntries(v) {
    // If variant has entryOrder, use it to interleave links, groups, separators, and footer markers
    if (v.entryOrder) {
      const groupMap = {};
      (v.groups || []).forEach(g => { groupMap[g.name] = g; });
      return v.entryOrder.map(e => {
        if (e.type === 'link') return { type: 'link', id: e.id };
        if (e.type === 'group' && groupMap[e.name]) return { type: 'group', group: groupMap[e.name] };
        if (e.type === 'separator') return { type: 'separator', label: e.label };
        if (e.type === 'footer-start') return { type: 'footer-start' };
        return null;
      }).filter(Boolean);
    }
    // Fallback: links first, then groups
    const entries = [];
    if (v.links) v.links.forEach(id => entries.push({ type: 'link', id }));
    if (v.groups) v.groups.forEach(g => entries.push({ type: 'group', group: g }));
    return entries;
  }

  function renderSidebar(v) {
    const sidebarMain = sidebar.querySelector('.sidebar-main');
    const scrollTop = sidebarMain ? sidebarMain.scrollTop : 0;
    let controlsHtml = '<div class="sidebar-controls"><button class="sidebar-ctrl-btn" id="expandAll">Expand All</button><button class="sidebar-ctrl-btn" id="collapseAll">Collapse All</button></div>';

    const entries = buildEntries(v);
    const globalRenderedRemoved = new Set();

    let mainHtml = controlsHtml;
    let footerHtml = '';
    let inFooter = false;

    entries.forEach(entry => {
      let entryHtml = '';

      if (entry.type === 'footer-start') {
        inFooter = true;
        return;
      }

      if (entry.type === 'separator') {
        entryHtml += '<div class="nav-separator">';
        if (entry.label) entryHtml += '<span class="nav-separator-label">' + esc(entry.label) + '</span>';
        entryHtml += '</div>';
      } else if (entry.type === 'link') {
        const id = entry.id;
        const item = itemsMap[id];
        if (!item) return;
        const name = getDisplayName(id, v);
        const changes = getItemChanges(id, v);
        const fb = getFb(v.id, id);
        const sel = state.selectedId === id ? ' selected' : '';
        entryHtml += '<div class="nav-group-header' + sel + '" data-id="' + id + '">';
        entryHtml += '<span class="group-name">' + esc(name) + '</span>';
        entryHtml += renderFbInline(fb);
        if (fb.vote || fb.comment) entryHtml += '<span class="fb-dot"></span>';
        entryHtml += '</div>';
      } else if (entry.type === 'group') {
        const g = entry.group;
        const isExpanded = state.expanded.has(g.name);
        const allIds = getAllGroupItemIds(g);
        const visibleCount = allIds.filter(id => !v.removed?.includes(id) && !itemsMap[id]?.flags?.includes('removed')).length;
        const groupId = 'group_' + g.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const groupSelected = state.selectedId === groupId;
        const groupFb = getFb(v.id, groupId);

        entryHtml += '<div class="nav-group-header' + (isExpanded ? ' expanded' : '') + (groupSelected ? ' selected' : '') + '" data-group="' + esc(g.name) + '" data-id="' + groupId + '">';
        entryHtml += '<span class="group-name">' + esc(g.name) + ' <span class="group-count">(' + visibleCount + ')</span></span>';
        entryHtml += renderFbInline(groupFb);
        if (groupFb.vote || groupFb.comment) entryHtml += '<span class="fb-dot"></span>';
        entryHtml += '<span class="chevron">›</span>';
        entryHtml += '</div>';
        entryHtml += '<div class="nav-child-wrap' + (isExpanded ? ' open' : '') + '">';

        if (g.subgroups) {
          g.subgroups.forEach(sg => {
            if (sg.label) entryHtml += '<div class="nav-subgroup-label">' + esc(sg.label) + '</div>';
            sg.items.forEach((id, ii) => { entryHtml += renderChildItem(id, v, g.name, ii); });
          });
        } else if (g.items) {
          g.items.forEach((id, ii) => { entryHtml += renderChildItem(id, v, g.name, ii); });
        }

        // Append removed items that originally belonged to this group
        const removedIds = v.removed || [];
        const renderedInGroup = new Set(getAllGroupItemIds(g));
        const gNameLower = g.name.toLowerCase();
        removedIds.forEach(rid => {
          if (renderedInGroup.has(rid)) return;
          if (globalRenderedRemoved.has(rid)) return;
          const rItem = itemsMap[rid];
          if (!rItem) return;
          const parentLower = (rItem.asIsParent || '').toLowerCase();
          const subGroupLower = (rItem.asIsGroup || '').toLowerCase();

          let matches = false;

          // Best match: use asIsGroup if available
          if (subGroupLower && gNameLower.includes(subGroupLower.toLowerCase())) {
            matches = true;
          } else if (subGroupLower && subGroupLower.toLowerCase().includes(gNameLower)) {
            matches = true;
          }
          // Direct parent match
          else if (parentLower === gNameLower) {
            matches = true;
          }
          // Contacts → Audience
          else if (parentLower === 'contacts' && (gNameLower === 'audience' || gNameLower.includes('contact'))) {
            // Use asIsGroup to pick the right sub-group
            if (!subGroupLower || subGroupLower === 'contact data') matches = true;
          }
          // Management → match by asIsGroup first
          else if (parentLower === 'management') {
            if (subGroupLower === 'account management' && gNameLower.includes('account')) matches = true;
            else if (subGroupLower === 'data management' && (gNameLower.includes('data') && !gNameLower.includes('account'))) matches = true;
            else if (!subGroupLower && gNameLower.includes('admin')) matches = true;
            // Fallback for Management when no subgroup and group is generic
            else if (!subGroupLower && gNameLower === 'management') matches = true;
          }
          // Channels → match by asIsGroup
          else if (parentLower === 'channels') {
            if (subGroupLower === 'email' && gNameLower.includes('email')) matches = true;
            else if (subGroupLower === 'mobile' && (gNameLower.includes('mobile') || gNameLower.includes('sms'))) matches = true;
            else if (subGroupLower === 'web' && gNameLower.includes('web')) matches = true;
            else if (gNameLower === 'channels') matches = true;
          }

          if (matches) {
            entryHtml += renderChildItem(rid, v, g.name, -1);
            globalRenderedRemoved.add(rid);
          }
        });

        entryHtml += '</div>';
      }

      if (inFooter) footerHtml += entryHtml;
      else mainHtml += entryHtml;
    });

    sidebar.innerHTML = '<div class="sidebar-main">' + mainHtml + '</div>' +
      (footerHtml ? '<div class="sidebar-footer"><div class="sidebar-footer-label">Footer</div>' + footerHtml + '</div>' : '');
    sidebar.querySelector('.sidebar-main').scrollTop = scrollTop;
    attachSidebarEvents();
  }

  function getAllGroupItemIds(g) {
    if (g.items) return g.items;
    if (g.subgroups) return g.subgroups.flatMap(sg => sg.items);
    return [];
  }

  function renderChildItem(id, v, groupName, itemIdx) {
    const item = itemsMap[id];
    if (!item) return '';
    const name = getDisplayName(id, v);
    const changes = getItemChanges(id, v);
    const isRemoved = changes.includes('removed');
    const fb = getFb(v.id, id);
    const sel = state.selectedId === id ? ' selected' : '';
    const removedCls = isRemoved ? ' is-removed' : '';
    const upvPct = item.upv ? Math.max(2, (item.upv / maxUpv) * 100) : 0;

    let pills = '';
    if (changes.length) {
      pills = '<span class="child-meta">' + changes.map(c => `<span class="pill pill-${c}">${c}</span>`).join('') + '</span>';
    }

    return `<div class="nav-child${sel}${removedCls}" data-id="${id}">
      <div class="child-content">
        <span class="child-name">${esc(name)}</span>
        ${pills}
        ${upvPct > 0 ? `<div class="upv-bar" style="width:${upvPct}%"></div>` : ''}
      </div>
      <div class="child-actions">
        ${renderFbInline(fb)}
        ${fb.vote || fb.comment ? '<span class="fb-dot"></span>' : ''}
      </div>
    </div>`;
  }

  function renderFbInline(fb) {
    const hasVote = fb.vote;
    const upCls = fb.vote === 'up' ? ' voted voted-up' : '';
    const downCls = fb.vote === 'down' ? ' voted voted-down' : '';
    return `<span class="fb-inline${hasVote ? ' has-vote' : ''}">
      <button class="fb-btn${upCls}" data-vote="up">👍</button>
      <button class="fb-btn${downCls}" data-vote="down">👎</button>
    </span>`;
  }

  function attachSidebarEvents() {
    // Expand All / Collapse All / Reorder toggle
    const expBtn = document.getElementById('expandAll');
    const colBtn = document.getElementById('collapseAll');
    if (expBtn) expBtn.addEventListener('click', () => {
      const v = currentVariant();
      (v.groups || []).forEach(g => state.expanded.add(g.name));
      render();
    });
    if (colBtn) colBtn.addEventListener('click', () => {
      state.expanded.clear();
      render();
    });

    sidebar.querySelectorAll('.nav-group-header').forEach(h => {
      h.addEventListener('click', (e) => {
        if (e.target.closest('.fb-btn')) return;
        const name = h.dataset.group;
        const groupId = h.dataset.id;
        // If clicking the chevron area (right 40px), just toggle expand
        const rect = h.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        if (clickX > rect.width - 40) {
          if (state.expanded.has(name)) state.expanded.delete(name);
          else state.expanded.add(name);
          render();
        } else {
          // Click on the name: select for detail AND expand
          state.selectedId = groupId;
          if (!state.expanded.has(name)) state.expanded.add(name);
          render();
        }
      });
    });

    sidebar.querySelectorAll('.nav-child, .nav-link').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.fb-btn')) return;
        state.selectedId = el.dataset.id;
        render();
      });
    });

    sidebar.querySelectorAll('.fb-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemEl = btn.closest('[data-id]');
        const itemId = itemEl.dataset.id;
        const voteType = btn.dataset.vote;
        const vid = currentVariantId();
        const cur = getFb(vid, itemId);
        if (cur.vote === voteType) {
          setFb(vid, itemId, 'vote', null);
        } else {
          setFb(vid, itemId, 'vote', voteType);
        }
        render();
      });
    });
  }

  // ===== RENDER DETAIL =====
  function renderDetail() {
    if (!state.selectedId) {
      detailPanel.innerHTML = '<div class="detail-empty">Select an item from the menu to see details.</div>';
      return;
    }
    const id = state.selectedId;

    // Check if it's a group selection
    if (id.startsWith('group_')) {
      renderGroupDetail(id);
      return;
    }

    const item = itemsMap[id];
    if (!item) { detailPanel.innerHTML = '<div class="detail-empty">Item not found.</div>'; return; }
    const v = currentVariant();
    const displayName = getDisplayName(id, v);
    const isRenamed = displayName !== item.name;
    const changes = getItemChanges(id, v);
    const fb = getFb(v.id, id);

    let html = '<div class="detail-header">';
    if (isRenamed) html += `<div class="detail-original">${esc(item.name)}</div>`;
    html += `<div class="detail-name">${esc(displayName)}</div>`;

    const pt = item.pageTitle;
    if (pt && pt !== 'Same' && pt !== item.name && pt !== displayName) {
      html += `<div class="detail-page-title">Page title: ${esc(pt)}</div>`;
    }
    html += `<div class="detail-id">${esc(id)}</div>`;
    html += '</div>';

    // About this feature
    if (item.rationale?.what) {
      html += '<div class="detail-section"><div class="detail-section-title">About</div>';
      html += `<div style="font-size:13px;line-height:1.6;color:#32363A">${esc(item.rationale.what)}</div>`;
      if (item.rationale?.officialCategory) {
        html += `<div style="margin-top:8px;padding:6px 10px;background:#E8F0FE;border-radius:4px;font-size:12px"><strong>SAP Help Portal:</strong> ${esc(item.rationale.officialCategory)}</div>`;
      }
      html += '</div>';
    }

    // Analytics
    html += '<div class="detail-section"><div class="detail-section-title">Usage Analytics</div>';
    if (item.upv || item.pv) {
      const isTopLevel = v.links?.includes(id);
      const vEntries = buildEntries(v);
      let rankPool;
      if (isTopLevel) {
        rankPool = vEntries.filter(entry => entry.type === 'link' || entry.type === 'group').map(entry => {
          if (entry.type === 'link') { const li = itemsMap[entry.id]; return { upv: li?.upv || 0, pv: li?.pv || 0 }; }
          else { const gItems = getAllGroupItemIds(entry.group).map(gid => itemsMap[gid]).filter(Boolean); return { upv: gItems.reduce((s,i) => s + (i.upv||0), 0), pv: gItems.reduce((s,i) => s + (i.pv||0), 0) }; }
        });
      } else {
        rankPool = [];
        vEntries.forEach(entry => { if (entry.type === 'group') getAllGroupItemIds(entry.group).forEach(gid => { const gi = itemsMap[gid]; if (gi) rankPool.push({ upv: gi.upv || 0, pv: gi.pv || 0 }); }); });
      }
      const platformTotalUpv = items.reduce((sum, it) => sum + (it.upv || 0), 0);
      const platformTotalPv = items.reduce((sum, it) => sum + (it.pv || 0), 0);
      const upvShare = platformTotalUpv > 0 ? (item.upv || 0) / platformTotalUpv : 0;
      const pvShare = platformTotalPv > 0 ? (item.pv || 0) / platformTotalPv : 0;
      const combinedShare = ((upvShare + pvShare) / 2 * 100);
      const combinedShareStr = combinedShare >= 1 ? combinedShare.toFixed(0) : combinedShare.toFixed(1);
      const maxPoolUpv = Math.max(...rankPool.map(r => r.upv), 1);
      const maxPoolPv = Math.max(...rankPool.map(r => r.pv), 1);
      const myScore = ((item.upv || 0) / maxPoolUpv + (item.pv || 0) / maxPoolPv) / 2;
      const combinedRank = rankPool.filter(r => ((r.upv / maxPoolUpv + r.pv / maxPoolPv) / 2) > myScore).length + 1;
      const poolSize = rankPool.length;
      const levelLabel = isTopLevel ? 'top-level' : 'child';

      html += '<div class="analytics-card analytics-card-with-score">';
      html += '<div class="analytics-detail">';
      if (item.upv != null) {
        const pct = (item.upv / maxUpv) * 100;
        html += `<div class="analytics-row"><span class="analytics-label">Unique Views</span><span class="analytics-value">${fmt(item.upv)}</span><div class="analytics-bar-wrap"><div class="analytics-bar" style="width:${pct}%"></div></div></div>`;
      }
      if (item.pv != null) {
        const maxPv = Math.max(...items.map(i => i.pv || 0));
        const pct = (item.pv / maxPv) * 100;
        html += `<div class="analytics-row"><span class="analytics-label">Page Views</span><span class="analytics-value">${fmt(item.pv)}</span><div class="analytics-bar-wrap"><div class="analytics-bar" style="width:${pct}%"></div></div></div>`;
      }
      html += '</div>';
      html += `<div class="analytics-score"><div class="analytics-score-pct">${combinedShareStr}%</div><div class="analytics-score-rank">Top ${combinedRank} of ${poolSize}</div><div class="analytics-score-level">${levelLabel}</div></div>`;
      html += '</div>';
    } else {
      html += '<div class="analytics-none">No analytics data available</div>';
    }
    html += '</div>';

    // Origin
    html += '<div class="detail-section"><div class="detail-section-title">Location</div>';
    const originPath = item.asIsGroup
      ? `${item.asIsParent} › ${item.asIsGroup} › ${item.name}`
      : `${item.asIsParent} › ${item.name}`;
    html += `<div class="origin-path"><strong>As-Is:</strong> ${esc(originPath)}</div>`;
    const curParent = getItemParentInVariant(id, v);
    if (curParent) {
      const movedNote = curParent !== item.asIsParent ? `<span class="moved-note">← moved from ${esc(item.asIsParent)}</span>` : '';
      html += `<div class="origin-path"><strong>This variant:</strong> ${esc(curParent)} ${movedNote}</div>`;
    } else if (changes.includes('removed')) {
      html += `<div class="origin-path" style="color:#D93025"><strong>This variant:</strong> Removed</div>`;
    }
    html += '</div>';

    // Across variants – smart grouped display
    html += '<div class="detail-section"><div class="detail-section-title">Across All Variants</div>';

    // Collect unique (parent, displayName) combinations and which variants use each
    const placements = [];
    for (const vid of ALL_VARIANT_IDS) {
      const vr = variantsMap[vid];
      if (!vr) continue;
      const isRemoved = vr.removed?.includes(id) || itemsMap[id]?.flags?.includes('removed');
      const parent = isRemoved ? null : getItemParentInVariant(id, vr);
      const dn = isRemoved ? null : getDisplayName(id, vr);
      placements.push({ vid, parent, name: dn, removed: isRemoved && !parent, isCurrent: vid === v.id });
    }

    // Group by (parent + name) key
    const groups = {};
    const removedVids = [];
    placements.forEach(p => {
      if (p.removed) { removedVids.push(p.vid); return; }
      if (!p.parent) return;
      const key = `${p.parent}|||${p.name}`;
      if (!groups[key]) groups[key] = { parent: p.parent, name: p.name, variants: [], hasCurrent: false };
      groups[key].variants.push(p.vid);
      if (p.isCurrent) groups[key].hasCurrent = true;
    });

    const groupList = Object.values(groups);

    if (groupList.length === 1 && removedVids.length === 0) {
      // All variants have the same parent and name – one compact line
      const g = groupList[0];
      html += `<div class="placement-row placement-compact">
        <span class="placement-parent">${esc(g.parent)}</span>
        <span class="placement-sep">→</span>
        <span class="placement-name">${esc(g.name)}</span>
        <span class="placement-note">Same in all variants</span>
      </div>`;
    } else {
      // Multiple placements – show grouped
      groupList.forEach(g => {
        const isCurrent = g.hasCurrent;
        html += `<div class="placement-row${isCurrent ? ' placement-current' : ''}">
          <span class="placement-parent">${esc(g.parent)}</span>
          <span class="placement-sep">→</span>
          <span class="placement-name">${esc(g.name)}</span>
          <span class="placement-variants">${g.variants.map(vid => {
            const isCur = vid === v.id;
            return `<span class="placement-vid${isCur ? ' placement-vid-current' : ''}">${esc((variantsMap[vid]||{}).name||vid)}</span>`;
          }).join(' ')}</span>
        </div>`;
      });
      if (removedVids.length > 0) {
        html += `<div class="placement-row placement-removed">
          <span class="placement-parent" style="color:#D93025">Removed</span>
          <span class="placement-variants">${removedVids.map(vid => `<span class="placement-vid">${esc((variantsMap[vid]||{}).name||vid)}</span>`).join(' ')}</span>
        </div>`;
      }
    }
    html += '</div>';

    // Changes
    if (changes.length) {
      html += '<div class="detail-section"><div class="detail-section-title">Changes in This Variant</div><ul style="padding-left:18px;font-size:13px;line-height:1.8">';
      changes.forEach(c => {
        if (c === 'renamed') html += `<li>Renamed from "${esc(item.name)}" to "${esc(displayName)}"</li>`;
        else if (c === 'moved') html += `<li>Moved from ${esc(item.asIsParent)} to ${esc(curParent || '?')}</li>`;
        else if (c === 'removed') html += `<li style="color:#D93025">Removed from menu</li>`;
        else if (c === 'new') html += `<li style="color:#188038">New item – page to be created</li>`;
        else if (c === 'custom') html += `<li style="color:#7B1FA2">Customer-specific feature</li>`;
      });
      html += '</ul></div>';
    }

    // Comments
    if (item.tillyCom || item.petiComment) {
      html += '<div class="detail-section"><div class="detail-section-title">Audit Comments</div>';
      if (item.petiComment) {
        html += `<div class="comment-box" style="margin-bottom:8px"><strong>Peti:</strong> ${esc(item.petiComment)}</div>`;
      }
      if (item.tillyCom) {
        html += `<div class="comment-box"><strong>TillyG:</strong> ${esc(item.tillyCom)}</div>`;
      }
      html += '</div>';
    }
    if (item.tillyName && item.tillyName !== '–' && item.tillyName !== '???') {
      html += `<div style="margin-top:6px;font-size:12px;color:#6A6D70">TillyG suggested name: <strong>${esc(item.tillyName)}</strong></div>`;
    }
    if (item.petiName && item.petiName !== '–') {
      html += `<div style="margin-top:4px;font-size:12px;color:#6A6D70">Peti suggested name: <strong>${esc(item.petiName)}</strong></div>`;
    }

    // Naming Rationale
    if (item.rationale?.namingRationale) {
      const r = item.rationale;
      html += '<div class="detail-section"><div class="detail-section-title">Naming Rationale</div>';
      html += '<div class="rationale-card">';
      html += `<div style="font-size:13px;line-height:1.6;margin-bottom:8px">${esc(r.namingRationale)}</div>`;
      if (r.namingSuggestion) {
        html += `<div style="padding:8px 10px;background:#E0F2E9;border-radius:4px;font-size:12px;color:#1B5E20"><strong>Recommendation:</strong> ${esc(r.namingSuggestion)}</div>`;
      }
      html += '</div></div>';
    }

    // Placement Rationale
    if (item.rationale) {
      const r = item.rationale;
      html += '<div class="detail-section"><div class="detail-section-title">Placement Rationale</div>';
      html += '<div class="rationale-card">';
      if (r.arguments) {
        html += '<div class="rationale-args"><strong>Arguments for each placement:</strong>';
        html += '<table class="rationale-table">';
        for (const [group, arg] of Object.entries(r.arguments)) {
          const isCurrent = curParent === group;
          html += `<tr class="${isCurrent ? 'rationale-current' : ''}">`;
          html += `<td class="rationale-group">${esc(group)}</td>`;
          html += `<td>${esc(arg)}</td>`;
          html += '</tr>';
        }
        html += '</table></div>';
      }
      if (r.currentChoice) {
        html += `<div class="rationale-choice"><strong>Current decision:</strong> ${esc(r.currentChoice)}</div>`;
      }
      if (r.openQuestion) {
        html += `<div class="rationale-question"><strong>Open question:</strong> ${esc(r.openQuestion)}</div>`;
      }
      html += '</div></div>';
    }

    // Feedback
    html += '<div class="detail-section"><div class="detail-section-title">Your Feedback</div><div class="feedback-section">';
    html += '<div class="feedback-vote-row">';
    html += `<button class="feedback-vote-btn${fb.vote === 'up' ? ' active-up' : ''}" data-detail-vote="up">👍 Like</button>`;
    html += `<button class="feedback-vote-btn${fb.vote === 'down' ? ' active-down' : ''}" data-detail-vote="down">👎 Dislike</button>`;
    html += '</div>';
    html += `<textarea class="feedback-comment-input" placeholder="Add a comment about this item in this variant..." data-detail-comment>${esc(fb.comment || '')}</textarea>`;
    html += '</div></div>';

    detailPanel.innerHTML = html;

    detailPanel.querySelectorAll('[data-detail-vote]').forEach(btn => {
      btn.addEventListener('click', () => {
        const vote = btn.dataset.detailVote;
        const cur = getFb(v.id, id);
        setFb(v.id, id, 'vote', cur.vote === vote ? null : vote);
        renderDetail();
        renderSidebar(v);
      });
    });
    const textarea = detailPanel.querySelector('[data-detail-comment]');
    if (textarea) {
      let debounce;
      textarea.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          setFb(v.id, id, 'comment', textarea.value);
        }, 300);
      });
    }
  }

  // ===== GROUP DETAIL =====
  function renderGroupDetail(groupId) {
    const v = currentVariant();
    const entries = buildEntries(v);

    // Find the group in the current variant
    let groupEntry = null;
    for (const entry of entries) {
      if (entry.type === 'group') {
        const gId = 'group_' + entry.group.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        if (gId === groupId) { groupEntry = entry; break; }
      }
    }

    if (!groupEntry) {
      detailPanel.innerHTML = '<div class="detail-empty">Group not found.</div>';
      return;
    }

    const g = groupEntry.group;
    const groupItems = getAllGroupItemIds(g).map(id => itemsMap[id]).filter(Boolean);
    const removedInGroup = (v.removed || []).filter(rid => {
      const rItem = itemsMap[rid];
      if (!rItem) return false;
      const parentLower = (rItem.asIsParent || '').toLowerCase();
      const gLower = g.name.toLowerCase();
      return parentLower === gLower ||
        (parentLower === 'contacts' && (gLower === 'audience' || gLower.includes('contact'))) ||
        (parentLower === 'management' && (gLower.includes('admin') || gLower.includes('account') || gLower.includes('data'))) ||
        (parentLower === 'channels' && gLower.includes('channel'));
    });

    // Analytics
    const totalUpv = groupItems.reduce((sum, it) => sum + (it.upv || 0), 0);
    const totalPv = groupItems.reduce((sum, it) => sum + (it.pv || 0), 0);
    const itemCount = groupItems.length;
    const itemsWithData = groupItems.filter(it => it.upv).length;
    const avgUpv = itemsWithData > 0 ? Math.round(totalUpv / itemsWithData) : 0;

    // Strength score: weighted by total UPV relative to platform total
    const platformTotalUpv = items.reduce((sum, it) => sum + (it.upv || 0), 0);
    const strengthPct = platformTotalUpv > 0 ? Math.round((totalUpv / platformTotalUpv) * 100) : 0;

    // Items sorted by UPV
    const sortedItems = [...groupItems].sort((a, b) => (b.upv || 0) - (a.upv || 0));

    // Compare group across variants
    const groupAcrossVariants = {};
    ALL_VARIANT_IDS.forEach(vid => {
      const vr = variantsMap[vid];
      if (!vr) return;
      const vrEntries = buildEntries(vr);
      for (const e of vrEntries) {
        if (e.type === 'group' && e.group.name === g.name) {
          groupAcrossVariants[vid] = { count: getAllGroupItemIds(e.group).length, name: g.name };
          return;
        }
      }
      // Group doesn't exist in this variant – check if items are elsewhere
      groupAcrossVariants[vid] = null;
    });

    // SAP categories of items in this group
    const sapCategories = {};
    groupItems.forEach(it => {
      const cat = it.rationale?.officialCategory;
      if (cat) {
        const topCat = cat.split('>')[0].trim();
        sapCategories[topCat] = (sapCategories[topCat] || 0) + 1;
      }
    });

    let html = '<div class="detail-header">';
    html += `<div class="detail-name">${esc(g.name)}</div>`;
    html += `<div style="font-size:12px;color:#6A6D70;margin-top:4px">${itemCount} items${removedInGroup.length ? ' + ' + removedInGroup.length + ' removed' : ''}</div>`;
    html += '</div>';

    // Strength indicator
    const allTopLevel = entries.filter(entry => entry.type === 'link' || entry.type === 'group').map(entry => {
      if (entry.type === 'link') { const it2 = itemsMap[entry.id]; return { name: it2?.name || entry.id, upv: it2?.upv || 0, pv: it2?.pv || 0 }; }
      else { const gItems2 = getAllGroupItemIds(entry.group).map(id2 => itemsMap[id2]).filter(Boolean); return { name: entry.group.name, upv: gItems2.reduce((s,i) => s + (i.upv||0), 0), pv: gItems2.reduce((s,i) => s + (i.pv||0), 0) }; }
    });
    const maxTopUpv = Math.max(...allTopLevel.map(t => t.upv), 1);
    const maxTopPv = Math.max(...allTopLevel.map(t => t.pv), 1);
    const myTopScore = (totalUpv / maxTopUpv + totalPv / maxTopPv) / 2;
    const topLevelRank = allTopLevel.filter(t => ((t.upv / maxTopUpv + t.pv / maxTopPv) / 2) > myTopScore).length + 1;
    const topLevelTotal = allTopLevel.length;
    const upvBarPct = maxTopUpv > 0 ? Math.round((totalUpv / maxTopUpv) * 100) : 0;
    const pvBarPct = maxTopPv > 0 ? Math.round((totalPv / maxTopPv) * 100) : 0;
    const grpCombinedShare = ((totalUpv / platformTotalUpv + totalPv / (items.reduce((s,i)=>s+(i.pv||0),0) || 1)) / 2 * 100);
    const grpCombinedShareStr = grpCombinedShare >= 1 ? grpCombinedShare.toFixed(0) : grpCombinedShare.toFixed(1);

    html += '<div class="detail-section"><div class="detail-section-title">Group Strength</div>';
    html += '<div class="analytics-card analytics-card-with-score">';
    html += '<div class="analytics-detail">';
    html += `<div class="analytics-row"><span class="analytics-label">Total UPV</span><span class="analytics-value">${fmt(totalUpv)}</span><div class="analytics-bar-wrap"><div class="analytics-bar" style="width:${upvBarPct}%"></div></div></div>`;
    html += `<div class="analytics-row"><span class="analytics-label">Total PV</span><span class="analytics-value">${fmt(totalPv)}</span><div class="analytics-bar-wrap"><div class="analytics-bar" style="width:${pvBarPct}%"></div></div></div>`;
    html += `<div class="analytics-row"><span class="analytics-label">Avg UPV/item</span><span class="analytics-value">${fmt(avgUpv)}</span></div>`;
    html += '</div>';
    html += `<div class="analytics-score"><div class="analytics-score-pct">${grpCombinedShareStr}%</div><div class="analytics-score-rank">Top ${topLevelRank} of ${topLevelTotal}</div><div class="analytics-score-level">top-level</div></div>`;
    html += '</div></div>';

    // Items ranked by usage
    html += '<div class="detail-section"><div class="detail-section-title">Items by Usage</div>';
    html += '<table class="variant-table"><thead><tr><th>Item</th><th style="text-align:right">UPV</th><th style="width:40%">Usage</th></tr></thead><tbody>';
    const maxGroupUpv = sortedItems[0]?.upv || 1;
    sortedItems.forEach(it => {
      const name = getDisplayName(it.id, v);
      const pct = it.upv ? Math.round((it.upv / maxGroupUpv) * 100) : 0;
      html += `<tr><td>${esc(name)}</td><td style="text-align:right;font-weight:600">${it.upv ? fmt(it.upv) : '—'}</td><td><div style="height:6px;background:#E5E5E6;border-radius:3px"><div style="height:100%;width:${pct}%;background:#0070F2;border-radius:3px"></div></div></td></tr>`;
    });
    html += '</tbody></table></div>';

    // SAP category alignment
    if (Object.keys(sapCategories).length > 0) {
      html += '<div class="detail-section"><div class="detail-section-title">SAP Help Portal Category Mix</div>';
      html += '<div style="font-size:12px;color:#6A6D70;margin-bottom:8px">Where SAP officially categorizes the items in this group:</div>';
      const sortedCats = Object.entries(sapCategories).sort((a, b) => b[1] - a[1]);
      sortedCats.forEach(([cat, count]) => {
        const pct = Math.round((count / itemCount) * 100);
        const isAligned = cat.toLowerCase().includes(g.name.toLowerCase().split(' ')[0]) || g.name.toLowerCase().includes(cat.toLowerCase().split(' ')[0]);
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">`;
        html += `<span style="min-width:180px;font-size:12px;font-weight:600">${esc(cat)}</span>`;
        html += `<span style="font-size:12px;color:#6A6D70">${count} item${count > 1 ? 's' : ''} (${pct}%)</span>`;
        if (!isAligned) html += `<span style="font-size:10px;color:#E76500;background:#FFF3E0;padding:1px 5px;border-radius:3px">misaligned</span>`;
        html += '</div>';
      });
      html += '</div>';
    }

    // Group across variants
    html += '<div class="detail-section"><div class="detail-section-title">Across Variants</div>';
    ALL_VARIANT_IDS.forEach(vid => {
      const vr = variantsMap[vid];
      if (!vr) return;
      const isCurrent = vid === v.id;
      const info = groupAcrossVariants[vid];
      if (info) {
        html += `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;${isCurrent ? 'font-weight:700;color:#0070F2' : ''}">`;
        html += `<span style="min-width:200px;font-size:12px">${esc(vr.name)}</span>`;
        html += `<span style="font-size:12px">${info.count} items</span>`;
        html += '</div>';
      } else {
        html += `<div style="padding:4px 0;font-size:12px;color:#8D9094">${esc(vr.name)}: group doesn't exist</div>`;
      }
    });
    html += '</div>';

    // Group Feedback
    const groupFb = getFb(v.id, groupId);
    html += '<div class="detail-section"><div class="detail-section-title">Your Feedback on this Group</div><div class="feedback-section">';
    html += '<div class="feedback-vote-row">';
    html += `<button class="feedback-vote-btn${groupFb.vote === 'up' ? ' active-up' : ''}" data-group-vote="up">👍 Good grouping</button>`;
    html += `<button class="feedback-vote-btn${groupFb.vote === 'down' ? ' active-down' : ''}" data-group-vote="down">👎 Needs change</button>`;
    html += '</div>';
    html += `<textarea class="feedback-comment-input" placeholder="Notes about this group (naming, items that should move, etc.)..." data-group-comment>${esc(groupFb.comment || '')}</textarea>`;
    html += '</div></div>';

    detailPanel.innerHTML = html;

    detailPanel.querySelectorAll('[data-group-vote]').forEach(btn => {
      btn.addEventListener('click', () => {
        const vote = btn.dataset.groupVote;
        const cur = getFb(v.id, groupId);
        setFb(v.id, groupId, 'vote', cur.vote === vote ? null : vote);
        renderGroupDetail(groupId);
        renderSidebar(v);
      });
    });
    const grpTextarea = detailPanel.querySelector('[data-group-comment]');
    if (grpTextarea) {
      let debounce;
      grpTextarea.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          setFb(v.id, groupId, 'comment', grpTextarea.value);
        }, 300);
      });
    }
  }
  function renderCompare() {
    // Always: As-Is fixed first + 3 selectable variant slots
    const selectableIds = state.compareColumns.slice(0, 3);
    const allColumns = ['as-is', ...selectableIds];

    const isShortlistCompare = state.mainTab === 'shortlist';
    if (isShortlistCompare) {
      allColumns.length = 0;
      allColumns.push('as-is', ...state.starred);
    }

    let html = '';
    allColumns.forEach((vid, ci) => {
      const v = variantsMap[vid];
      if (!v) return;
      const isAsIs = vid === 'as-is';
      html += `<div class="compare-col${isAsIs ? ' compare-col-asis' : ''}" data-compare-variant="${vid}">`;

      if (isAsIs) {
        html += `<div class="compare-col-header compare-col-header-asis">${esc(v.name)}</div>`;
      } else if (!isShortlistCompare) {
        // Selectable header with dropdown – disable already-selected variants in other slots
        const slotIdx = ci - 1;
        const otherSelected = new Set(selectableIds.filter((id, i) => i !== slotIdx));
        html += `<div class="compare-col-header"><select class="compare-col-select" data-compare-slot="${slotIdx}">`;
        ALL_VARIANT_IDS.filter(id => id !== 'as-is').forEach(oid => {
          const ov = variantsMap[oid];
          const isDisabled = otherSelected.has(oid);
          if (ov) html += `<option value="${oid}"${oid === vid ? ' selected' : ''}${isDisabled ? ' disabled' : ''}>${ov.name}${isDisabled ? ' (in use)' : ''}</option>`;
        });
        html += '</select></div>';
      } else {
        // Fixed header (shortlist, no dropdown)
        html += `<div class="compare-col-header">${esc(v.name)}</div>`;
      }

      // Use buildEntries to match sidebar order
      const entries = buildEntries(v);
      entries.forEach(entry => {
        if (entry.type === 'separator') {
          html += `<div class="compare-separator-label">${entry.label ? esc(entry.label) : ''}</div>`;
        } else if (entry.type === 'footer-start') {
          html += `<div class="compare-divider" style="height:2px;background:#E5E5E6;margin:6px 0"></div>`;
        } else if (entry.type === 'link') {
          const id = entry.id;
          const name = getDisplayName(id, v);
          const fb = getFb(vid, id);
          const hasVote = fb.vote;
          const upCls = fb.vote === 'up' ? ' voted voted-up' : '';
          const downCls = fb.vote === 'down' ? ' voted voted-down' : '';
          html += `<div class="compare-link" data-cid="${id}" data-cvid="${vid}"><span>${esc(name)}</span><span class="compare-fb${hasVote ? ' has-vote' : ''}"><button class="compare-fb-btn${upCls}" data-cfb-vote="up" data-cfb-vid="${vid}" data-cfb-id="${id}">👍</button><button class="compare-fb-btn${downCls}" data-cfb-vote="down" data-cfb-vid="${vid}" data-cfb-id="${id}">👎</button></span></div>`;
        } else if (entry.type === 'group') {
          const g = entry.group;
          const gKey = vid + '_' + g.name;
          const isExpanded = state.compareExpanded ? state.compareExpanded.has(gKey) : true;
          const childCount = getAllGroupItemIds(g).length;
          html += `<div class="compare-group-name" data-cgroup="${esc(gKey)}" style="cursor:pointer"><span>${esc(g.name)}</span> <span style="font-size:10px;color:#8D9094">(${childCount})</span> <span class="compare-chevron" style="font-size:10px;color:#8D9094;margin-left:auto">${isExpanded ? '▾' : '›'}</span></div>`;
          html += `<div class="compare-child-wrap" data-cchildren="${esc(gKey)}" style="${isExpanded ? '' : 'display:none'}">`;

          const renderCompareItem = (id) => {
            const item = itemsMap[id];
            if (!item) return;
            const name = getDisplayName(id, v);
            const changes = getItemChanges(id, v);
            const isRemoved = changes.includes('removed');
            let pillsHtml = changes.filter(c=>c!=='removed').map(c => `<span class="pill pill-${c}">${c}</span>`).join('');
            const fb = getFb(vid, id);
            const hasVote = fb.vote;
            const upCls = fb.vote === 'up' ? ' voted voted-up' : '';
            const downCls = fb.vote === 'down' ? ' voted voted-down' : '';
            html += `<div class="compare-item${isRemoved ? ' is-removed' : ''}" data-cid="${id}" data-cvid="${vid}"><span>${esc(name)}${pillsHtml}</span><span class="compare-fb${hasVote ? ' has-vote' : ''}"><button class="compare-fb-btn${upCls}" data-cfb-vote="up" data-cfb-vid="${vid}" data-cfb-id="${id}">👍</button><button class="compare-fb-btn${downCls}" data-cfb-vote="down" data-cfb-vid="${vid}" data-cfb-id="${id}">👎</button></span></div>`;
          };

          if (g.subgroups) {
            g.subgroups.forEach(sg => {
              if (sg.label) html += `<div class="compare-subgroup-label">${esc(sg.label)}</div>`;
              sg.items.forEach(id => renderCompareItem(id));
            });
          } else {
            (g.items || []).forEach(id => renderCompareItem(id));
          }

          html += '</div>';
        }
      });

      html += '</div>';
    });

    compareView.innerHTML = html;

    compareView.querySelectorAll('[data-cid]').forEach(el => {
      el.addEventListener('mouseenter', () => {
        const cid = el.dataset.cid;
        compareView.querySelectorAll(`[data-cid="${cid}"]`).forEach(e => e.classList.add('highlight'));
      });
      el.addEventListener('mouseleave', () => {
        const cid = el.dataset.cid;
        compareView.querySelectorAll(`[data-cid="${cid}"]`).forEach(e => e.classList.remove('highlight'));
      });
      el.addEventListener('click', (e) => {
        if (e.target.closest('.compare-fb-btn')) return; // handled below
        const cid = el.dataset.cid;
        compareView.querySelectorAll(`[data-cid="${cid}"]`).forEach(e => {
          if (e !== el) e.scrollIntoView({ behavior: 'smooth', block: 'center' });
          e.classList.add('compare-pulse');
          setTimeout(() => e.classList.remove('compare-pulse'), 1500);
        });
      });
    });

    // Compare feedback buttons
    compareView.querySelectorAll('.compare-fb-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const vid = btn.dataset.cfbVid;
        const itemId = btn.dataset.cfbId;
        const voteType = btn.dataset.cfbVote;
        const cur = getFb(vid, itemId);
        setFb(vid, itemId, 'vote', cur.vote === voteType ? null : voteType);
        renderCompare();
      });
    });

    // Compare column dropdown selects
    compareView.querySelectorAll('.compare-col-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const slot = parseInt(sel.dataset.compareSlot);
        state.compareColumns[slot] = sel.value;
        renderCompare();
      });
    });

    // Compare group expand/collapse
    if (!state.compareExpanded) state.compareExpanded = new Set();

    compareView.querySelectorAll('[data-cgroup]').forEach(header => {
      header.addEventListener('click', () => {
        const gKey = header.dataset.cgroup;
        if (state.compareExpanded.has(gKey)) {
          state.compareExpanded.delete(gKey);
        } else {
          state.compareExpanded.add(gKey);
        }
        const children = compareView.querySelectorAll(`[data-cchildren="${gKey}"]`);
        const isNowExpanded = state.compareExpanded.has(gKey);
        children.forEach(c => { c.style.display = isNowExpanded ? '' : 'none'; });
        const chevron = header.querySelector('.compare-chevron');
        if (chevron) chevron.textContent = isNowExpanded ? '▾' : '›';
      });
    });

    // Expand All / Collapse All
    const expAllBtn = document.getElementById('compareExpandAll');
    const colAllBtn = document.getElementById('compareCollapseAll');
    if (expAllBtn) expAllBtn.addEventListener('click', () => {
      compareView.querySelectorAll('[data-cgroup]').forEach(h => {
        state.compareExpanded.add(h.dataset.cgroup);
      });
      compareView.querySelectorAll('.compare-child-wrap').forEach(c => { c.style.display = ''; });
      compareView.querySelectorAll('.compare-chevron').forEach(c => { c.textContent = '▾'; });
    });
    if (colAllBtn) colAllBtn.addEventListener('click', () => {
      state.compareExpanded.clear();
      compareView.querySelectorAll('.compare-child-wrap').forEach(c => { c.style.display = 'none'; });
      compareView.querySelectorAll('.compare-chevron').forEach(c => { c.textContent = '›'; });
    });
  }

  // ===== CUSTOM BUILDER =====
  function saveCustom() {
    localStorage.setItem('menuDemoCustom', JSON.stringify(state.custom));
  }

  function getCustomItemIds() {
    if (!state.custom) return new Set();
    const ids = new Set();
    const entries = state.custom.entries || buildCustomEntries(state.custom);
    entries.forEach(e => {
      if (e.type === 'link') ids.add(e.id);
      else if (e.type === 'group') e.items.forEach(it => ids.add(it.id));
    });
    return ids;
  }

  // Convert old links+groups format to unified entries
  function buildCustomEntries(custom) {
    const entries = [];
    if (custom.links) custom.links.forEach(id => entries.push({ type: 'link', id, customName: null }));
    if (custom.groups) custom.groups.forEach(g => entries.push({ type: 'group', name: g.name, items: g.items || [] }));
    return entries;
  }

  // Ensure custom state uses entries format
  function migrateCustomToEntries() {
    if (state.custom && !state.custom.entries) {
      state.custom.entries = buildCustomEntries(state.custom);
      delete state.custom.links;
      delete state.custom.groups;
      saveCustom();
    }
  }
  migrateCustomToEntries();

  function renderCustom() {
    const isEditMode = !!state.editingVariantId;
    const sourceVariant = isEditMode ? state.editOriginal : (variantsMap[state.customSource] || variantsMap['as-is']);
    const customIds = getCustomItemIds();

    // Save scroll positions
    const srcEl = customView.querySelector('.custom-source');
    const tgtEl = customView.querySelector('.custom-target');
    const srcScroll = srcEl ? srcEl.scrollTop : 0;
    const tgtScroll = tgtEl ? tgtEl.scrollTop : 0;

    let html = '<div class="custom-toolbar">';
    if (isEditMode) {
      html += `<span style="font-size:12px;color:#6A6D70">Editing:</span><input class="custom-variant-name-input" id="customVariantName" value="${esc(state.editOriginal.name)}" style="font-size:14px;font-weight:600;border:none;border-bottom:1px solid #E5E5E6;padding:2px 6px;font-family:inherit;background:transparent;min-width:200px">`;
      html += '<span class="custom-toolbar-right"><button class="btn-custom btn-custom-primary" id="customSaveChanges">Save Changes</button>';
      html += '<button class="btn-custom" id="customExport">Export as JSON</button>';
      html += '<button class="btn-custom" id="customDiscard">Discard</button></span>';
    } else {
      const variantOptions = ALL_VARIANT_IDS.map(vid => {
        const v = variantsMap[vid];
        return v ? `<option value="${vid}"${vid === state.customSource ? ' selected' : ''}>${v.name} – ${v.subtitle}</option>` : '';
      }).join('');
      html += `<label style="font-size:12px;font-weight:600;color:#6A6D70">Source:</label>
        <select id="customSourceSelect">${variantOptions}</select>
        <button class="btn-custom btn-custom-primary" id="customPopulate">Start from source</button>
        <button class="btn-custom btn-custom-primary" id="customAddVariant">Add as Variant</button>
        <button class="btn-custom" id="customExport">Export as JSON</button>
        <button class="btn-custom" id="customClear">Clear</button>`;
    }
    html += '</div>';

    html += '<div class="custom-panels">';

    // === SOURCE PANEL ===
    if (isEditMode) {
      html += `<div class="custom-source"><div class="custom-source-header">Original: ${esc(state.editOriginal.name)}</div>`;
    } else {
      html += '<div class="custom-source"><div class="custom-source-header">Source Menu (drag from here)</div>';
    }

    // Source panel – use buildEntries for correct order
    const srcEntries = buildEntries(sourceVariant);
    srcEntries.forEach(entry => {
      if (entry.type === 'link') {
        const id = entry.id;
        const item = itemsMap[id];
        if (!item) return;
        const name = getDisplayName(id, sourceVariant);
        const inCustom = customIds.has(id);
        html += `<div class="custom-src-group"><div class="custom-src-item${inCustom ? ' in-custom' : ''}" draggable="${!inCustom}" data-src-id="${id}" data-src-type="link"><span class="drag-icon">\u283F</span><strong>${esc(name)}</strong></div></div>`;
      } else if (entry.type === 'group') {
        const g = entry.group;
        html += `<div class="custom-src-group"><div class="custom-src-group-name">${esc(g.name)}</div>`;
        const allIds = getAllGroupItemIds(g);
        allIds.forEach(id => {
          const item = itemsMap[id];
          if (!item) return;
          if (sourceVariant.removed?.includes(id)) return;
          const name = getDisplayName(id, sourceVariant);
          const inCustom = customIds.has(id);
          html += `<div class="custom-src-item${inCustom ? ' in-custom' : ''}" draggable="${!inCustom}" data-src-id="${id}" data-src-type="item"><span class="drag-icon">\u283F</span>${esc(name)}</div>`;
        });
        html += '</div>';
      }
    });
    html += '</div>';

    // === TARGET PANEL ===
    html += '<div class="custom-target"><div class="custom-target-header">Your Custom Menu (drag to here, reorder, rename)</div>';

    if (state.custom) {
      // Unified entries: render links and groups in order
      // Custom data stores entries[] if available, otherwise build from links+groups
      const entries = state.custom.entries || buildCustomEntries(state.custom);

      html += '<div class="custom-tgt-entries">';
      // Add a drop bar before the first entry
      html += `<div class="entry-drop-bar" data-entry-drop="0"></div>`;
      entries.forEach((entry, ei) => {
        if (entry.type === 'separator') {
          html += `<div class="custom-tgt-entry-link" draggable="true" data-tgt-entry-idx="${ei}" style="background:#F5F6F7;border-style:dashed;font-weight:600;color:#8D9094;font-size:12px">
            <span class="drag-handle">\u283F</span>
            <span style="flex:1">${esc(entry.label || 'Separator')}</span>
            <button class="custom-tgt-item-remove" data-remove-entry="${ei}">\u2715</button>
          </div>`;
        } else if (entry.type === 'footer-start') {
          html += `<div class="custom-tgt-entry-link" draggable="true" data-tgt-entry-idx="${ei}" style="background:#FFF8E1;border:2px dashed #F9A825;font-weight:700;color:#E76500;font-size:11px;text-transform:uppercase;letter-spacing:.5px;justify-content:center">
            <span class="drag-handle">\u283F</span>
            <span style="flex:1;text-align:center">Footer Section</span>
            <button class="custom-tgt-item-remove" data-remove-entry="${ei}">\u2715</button>
          </div>`;
        } else if (entry.type === 'link') {
          const item = itemsMap[entry.id];
          if (!item) return;
          const displayName = entry.customName || item.name;
          html += `<div class="custom-tgt-entry-link" draggable="true" data-tgt-entry-idx="${ei}" data-tgt-id="${entry.id}">
            <span class="drag-handle">\u283F</span>
            <input class="custom-tgt-item-name" value="${esc(displayName)}" data-rename-entry="${ei}">
            <button class="custom-tgt-item-remove" data-remove-entry="${ei}">\u2715</button>
          </div>`;
        } else if (entry.type === 'group') {
          html += `<div class="custom-tgt-group" data-tgt-entry-idx="${ei}">
            <div class="custom-tgt-group-header" draggable="true" data-tgt-entry-idx="${ei}">
              <span class="drag-handle">\u283F</span>
              <input class="custom-tgt-group-name" value="${esc(entry.name)}" data-rename-entry-group="${ei}">
              <span class="custom-tgt-group-count">(${entry.items.length})</span>
              <button class="custom-tgt-group-remove" data-remove-entry="${ei}">\u2715</button>
            </div>
            <div class="custom-tgt-items" data-drop-zone="group-${ei}">`;

          entry.items.forEach((it, ii) => {
            const item = itemsMap[it.id];
            if (!item) return;
            const displayName = it.customName || item.name;
            const showOriginal = it.customName && it.customName !== item.name;
            html += `<div class="custom-tgt-item" draggable="true" data-tgt-id="${it.id}" data-tgt-zone="group-${ei}" data-tgt-idx="${ii}">
              <span class="drag-handle">\u283F</span>
              <input class="custom-tgt-item-name" value="${esc(displayName)}" data-rename-id="${it.id}" data-rename-group="${ei}" data-rename-idx="${ii}">
              ${showOriginal ? `<span class="custom-tgt-item-original">(${esc(item.name)})</span>` : ''}
              <button class="custom-tgt-item-remove" data-remove-id="${it.id}" data-remove-group="${ei}">\u2715</button>
            </div>`;
          });

          html += '</div></div>';
        }
        // Drop bar after each entry
        html += `<div class="entry-drop-bar" data-entry-drop="${ei + 1}"></div>`;
      });
      html += '</div>';

      // Add group or standalone item
      html += `<div class="custom-add-group">
        <input type="text" id="customNewEntryName" placeholder="Name...">
        <button id="customAddGroup">Add Group</button>
        <button id="customAddItem">Add Item</button>
        <button id="customAddSeparator">Add Separator</button>
        <button id="customAddFooter">Add Footer Divider</button>
      </div>`;
    } else {
      html += '<div class="custom-tgt-entries" data-drop-zone="entries"></div>';
      html += '<div style="padding:20px;text-align:center;color:#8D9094;font-size:13px">Click "Start from source" to pre-populate, or add groups/items below.</div>';
      html += `<div class="custom-add-group">
        <input type="text" id="customNewEntryName" placeholder="Name...">
        <button id="customAddGroup">Add Group</button>
        <button id="customAddItem">Add Item</button>
        <button id="customAddSeparator">Add Separator</button>
        <button id="customAddFooter">Add Footer Divider</button>
      </div>`;
    }

    html += '</div></div>';

    customView.innerHTML = html;

    // Restore scroll positions
    const newSrcEl = customView.querySelector('.custom-source');
    const newTgtEl = customView.querySelector('.custom-target');
    if (newSrcEl) newSrcEl.scrollTop = srcScroll;
    if (newTgtEl) newTgtEl.scrollTop = tgtScroll;

    attachCustomEvents();
  }

  function attachCustomEvents() {
    // === EDIT MODE HANDLERS ===
    const saveBtn = document.getElementById('customSaveChanges');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      if (!state.editingVariantId || !state.custom?.entries) return;
      const orig = state.editOriginal;
      const newName = document.getElementById('customVariantName')?.value || orig.name;
      if (!confirm(`Save changes to "${newName}"?\nThis will overwrite the variant file.`)) return;

      const entries = state.custom.entries;
      const updated = {
        id: orig.id,
        name: newName,
        subtitle: orig.subtitle,
        description: orig.description,
        links: entries.filter(e => e.type === 'link').map(e => e.id),
        groups: entries.filter(e => e.type === 'group').map(g => ({
          name: g.name,
          items: g.items.map(it => it.id)
        })),
        entryOrder: entries.map(e => {
          if (e.type === 'link') return { type: 'link', id: e.id };
          if (e.type === 'group') return { type: 'group', name: e.name };
          if (e.type === 'separator') return { type: 'separator', label: e.label };
          if (e.type === 'footer-start') return { type: 'footer-start' };
          return null;
        }).filter(Boolean),
        renames: { ...(orig.renames || {}) },
        removed: orig.removed || ['add_contact', 'self_service_sso']
      };
      // Update renames from custom entries
      entries.forEach(e => {
        if (e.type === 'link' && e.customName && e.customName !== itemsMap[e.id]?.name) {
          updated.renames[e.id] = e.customName;
        } else if (e.type === 'link' && !e.customName) {
          // Keep existing rename if any
        }
        if (e.type === 'group') {
          e.items.forEach(it => {
            if (it.customName && it.customName !== itemsMap[it.id]?.name) {
              updated.renames[it.id] = it.customName;
            }
          });
        }
      });

      // Save to server
      try {
        const resp = await fetch(`/save/variant/${orig.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated)
        });
        if (!resp.ok) throw new Error('Server error');
      } catch (e) {
        alert('Could not save to server. Make sure you are running server.py.\nChanges applied in-memory only.');
      }

      // Update in-memory
      variantsMap[orig.id] = updated;

      // Close overlay
      state.editingVariantId = null;
      state.editOriginal = null;
      customOverlay.style.display = 'none';
      customOverlay.classList.remove('active');
      render();
      if (state.viewMode === 'compare') renderCompare();
      updateSubToggle(); // refresh tab names in case variant was renamed
    });

    const discardBtn = document.getElementById('customDiscard');
    if (discardBtn) discardBtn.addEventListener('click', () => {
      if (confirm('Discard all changes?')) {
        state.editingVariantId = null;
        state.editOriginal = null;
        customOverlay.style.display = 'none';
        customOverlay.classList.remove('active');
      }
    });

    // === CUSTOM BUILDER HANDLERS ===
    // Source select
    const sel = document.getElementById('customSourceSelect');
    if (sel) sel.addEventListener('change', () => { state.customSource = sel.value; renderCustom(); });

    // Populate from source
    const popBtn = document.getElementById('customPopulate');
    if (popBtn) popBtn.addEventListener('click', () => {
      const sv = variantsMap[state.customSource];
      if (!sv) return;
      const builtEntries = buildEntries(sv);
      const entries = builtEntries.map(entry => {
        if (entry.type === 'link') {
          return { type: 'link', id: entry.id, customName: sv.renames?.[entry.id] || null };
        } else if (entry.type === 'separator') {
          return { type: 'separator', label: entry.label };
        } else if (entry.type === 'footer-start') {
          return { type: 'footer-start' };
        } else {
          return {
            type: 'group',
            name: entry.group.name,
            items: getAllGroupItemIds(entry.group).filter(id => !sv.removed?.includes(id)).map(id => ({
              id, customName: sv.renames?.[id] || null
            }))
          };
        }
      });
      state.custom = { entries };
      saveCustom();
      renderCustom();
    });

    // Export
    const expBtn = document.getElementById('customExport');
    if (expBtn) expBtn.addEventListener('click', () => {
      if (!state.custom?.entries) return;
      const entries = state.custom.entries;
      const output = {
        id: 'custom',
        name: 'Custom',
        subtitle: 'User-Created',
        description: 'Custom menu variant created in the builder.',
        links: entries.filter(e => e.type === 'link').map(e => e.id),
        groups: entries.filter(e => e.type === 'group').map(g => ({
          name: g.name,
          items: g.items.map(it => it.id)
        })),
        entryOrder: entries.map(e => {
          if (e.type === 'link') return { type: 'link', id: e.id };
          if (e.type === 'group') return { type: 'group', name: e.name };
          if (e.type === 'separator') return { type: 'separator', label: e.label };
          if (e.type === 'footer-start') return { type: 'footer-start' };
          return null;
        }).filter(Boolean),
        renames: {},
        removed: ['add_contact', 'self_service_sso']
      };
      entries.forEach(e => {
        if (e.type === 'link' && e.customName && e.customName !== itemsMap[e.id]?.name) {
          output.renames[e.id] = e.customName;
        }
        if (e.type === 'group') {
          e.items.forEach(it => {
            if (it.customName && it.customName !== itemsMap[it.id]?.name) {
              output.renames[it.id] = it.customName;
            }
          });
        }
      });
      const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'variant-custom.json'; a.click();
      URL.revokeObjectURL(url);
    });

    // Add as Variant
    const addVarBtn = document.getElementById('customAddVariant');
    if (addVarBtn) addVarBtn.addEventListener('click', () => {
      if (!state.custom?.entries?.length) { alert('Build a menu first.'); return; }

      const custNum = ALL_VARIANT_IDS.filter(id => id.startsWith('cust')).length + 1;
      const varId = 'cust' + custNum;
      const varCode = 'CUST' + custNum;
      const varName = prompt('Name for this variant:', 'Custom ' + custNum + ' (' + varCode + ')');
      if (!varName) return;

      const entries = state.custom.entries || [];
      const variant = {
        id: varId,
        name: varName,
        subtitle: 'User-Created',
        description: 'Custom menu variant created in the builder.',
        links: entries.filter(e => e.type === 'link').map(e => e.id),
        groups: entries.filter(e => e.type === 'group').map(g => ({
          name: g.name,
          items: g.items.map(it => it.id)
        })),
        entryOrder: entries.map(e => {
          if (e.type === 'link') return { type: 'link', id: e.id };
          if (e.type === 'group') return { type: 'group', name: e.name };
          if (e.type === 'separator') return { type: 'separator', label: e.label };
          if (e.type === 'footer-start') return { type: 'footer-start' };
          return null;
        }).filter(Boolean),
        renames: {},
        removed: ['add_contact', 'self_service_sso']
      };
      entries.forEach(e => {
        if (e.type === 'link' && e.customName && e.customName !== itemsMap[e.id]?.name) {
          variant.renames[e.id] = e.customName;
        }
        if (e.type === 'group') {
          e.items.forEach(it => {
            if (it.customName && it.customName !== itemsMap[it.id]?.name) {
              variant.renames[it.id] = it.customName;
            }
          });
        }
      });

      // Add to runtime
      variantsMap[varId] = variant;
      if (!ALL_VARIANT_IDS.includes(varId)) ALL_VARIANT_IDS.push(varId);
      if (!VARIANT_FILES.includes('variant-' + varId)) VARIANT_FILES.push('variant-' + varId);

      // Add to UX tab
      const nextKey = String(Object.keys(TAB_MAP['ux']).length + 1);
      TAB_MAP['ux'][nextKey] = varId;
      SUB_LABELS['ux'][nextKey] = varCode;

      // Switch to the new variant in menu view
      state.mainTab = 'ux';
      state.sub = nextKey;
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'ux'));
      updateSubToggle();

      // Close overlay and switch to menu
      customOverlay.style.display = 'none';
      customOverlay.classList.remove('active');
      setViewMode('menu');
      render();
    });

    // Clear
    const clrBtn = document.getElementById('customClear');
    if (clrBtn) clrBtn.addEventListener('click', () => {
      if (confirm('Clear custom menu?')) { state.custom = null; saveCustom(); renderCustom(); }
    });

    // Add group
    const addGroupBtn = document.getElementById('customAddGroup');
    const addItemBtn = document.getElementById('customAddItem');
    const addInput = document.getElementById('customNewEntryName');
    if (addGroupBtn && addInput) {
      addGroupBtn.addEventListener('click', () => {
        const name = addInput.value.trim();
        if (!name) return;
        if (!state.custom) state.custom = { entries: [] };
        if (!state.custom.entries) state.custom.entries = [];
        state.custom.entries.push({ type: 'group', name, items: [] });
        saveCustom();
        renderCustom();
      });
    }
    if (addItemBtn && addInput) {
      addItemBtn.addEventListener('click', () => {
        const name = addInput.value.trim();
        if (!name) return;
        if (!state.custom) state.custom = { entries: [] };
        if (!state.custom.entries) state.custom.entries = [];
        // Create a standalone link entry with a generated ID
        const itemId = 'custom_item_' + Date.now();
        // Add to itemsMap so it can be displayed
        if (!itemsMap[itemId]) {
          itemsMap[itemId] = { id: itemId, name, pageTitle: name, asIsParent: null, asIsGroup: null, type: 'link', upv: null, pv: null, tillyName: '–', tillyCom: '' };
          items.push(itemsMap[itemId]);
        }
        state.custom.entries.push({ type: 'link', id: itemId, customName: name });
        saveCustom();
        renderCustom();
      });
    }

    // Add separator
    const addSepBtn = document.getElementById('customAddSeparator');
    if (addSepBtn) {
      addSepBtn.addEventListener('click', () => {
        if (!state.custom) state.custom = { entries: [] };
        if (!state.custom.entries) state.custom.entries = [];
        const label = addInput ? (addInput.value.trim() || 'Section') : 'Section';
        state.custom.entries.push({ type: 'separator', label: label });
        saveCustom();
        renderCustom();
      });
    }

    // Add footer divider
    const addFooterBtn = document.getElementById('customAddFooter');
    if (addFooterBtn) {
      addFooterBtn.addEventListener('click', () => {
        if (!state.custom) state.custom = { entries: [] };
        if (!state.custom.entries) state.custom.entries = [];
        if (!state.custom.entries.some(e => e.type === 'footer-start')) {
          state.custom.entries.push({ type: 'footer-start' });
          saveCustom();
          renderCustom();
        }
      });
    }

    // Entry-level rename (group name or link name, debounced)
    customView.querySelectorAll('[data-rename-entry-group]').forEach(input => {
      let debounce;
      input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const ei = parseInt(input.dataset.renameEntryGroup);
          if (state.custom?.entries[ei]?.type === 'group') {
            state.custom.entries[ei].name = input.value;
            saveCustom();
          }
        }, 300);
      });
    });
    customView.querySelectorAll('[data-rename-entry]').forEach(input => {
      if (input.dataset.renameId) return; // skip child item renames
      let debounce;
      input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const ei = parseInt(input.dataset.renameEntry);
          if (state.custom?.entries[ei]?.type === 'link') {
            state.custom.entries[ei].customName = input.value;
            saveCustom();
          }
        }, 300);
      });
    });

    // Item name rename within groups (debounced)
    customView.querySelectorAll('[data-rename-id][data-rename-group]').forEach(input => {
      let debounce;
      input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const itemId = input.dataset.renameId;
          const ei = parseInt(input.dataset.renameGroup);
          if (state.custom?.entries[ei]?.type === 'group') {
            const item = state.custom.entries[ei].items.find(it => it.id === itemId);
            if (item) { item.customName = input.value; saveCustom(); }
          }
        }, 300);
      });

      // Autosuggest: show name variants on focus
      input.addEventListener('focus', () => {
        const itemId = input.dataset.renameId;
        showNameSuggest(input, itemId);
      });
      input.addEventListener('blur', () => {
        setTimeout(() => { closeSuggest(); }, 150);
      });
    });

    // Autosuggest for entry-level link names too
    customView.querySelectorAll('[data-rename-entry]').forEach(input => {
      if (input.dataset.renameId) return;
      const ei = parseInt(input.dataset.renameEntry);
      const entry = state.custom?.entries?.[ei];
      if (entry?.type === 'link') {
        input.addEventListener('focus', () => showNameSuggest(input, entry.id));
        input.addEventListener('blur', () => setTimeout(() => closeSuggest(), 150));
      }
    });

    // Highlight origin in source panel when hovering target items
    customView.querySelectorAll('.custom-tgt-item[data-tgt-id], .custom-tgt-entry-link[data-tgt-id]').forEach(el => {
      el.addEventListener('mouseenter', () => {
        const id = el.dataset.tgtId;
        customView.querySelectorAll('.highlight-origin').forEach(h => h.classList.remove('highlight-origin'));
        const srcItem = customView.querySelector(`.custom-src-item[data-src-id="${id}"]`);
        if (srcItem) {
          srcItem.classList.add('highlight-origin');
          srcItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      el.addEventListener('mouseleave', () => {
        customView.querySelectorAll('.highlight-origin').forEach(h => h.classList.remove('highlight-origin'));
      });
    });

    // Name suggest helper functions
    function buildNameVariants(itemId) {
      const item = itemsMap[itemId];
      if (!item) return [];
      const names = [];
      const seen = new Set();
      // Original
      if (item.name) { names.push({ name: item.name, source: 'Original' }); seen.add(item.name); }
      // Peti
      if (item.petiName && item.petiName !== '–' && !seen.has(item.petiName)) { names.push({ name: item.petiName, source: 'Peti' }); seen.add(item.petiName); }
      // TillyG
      if (item.tillyName && item.tillyName !== '–' && item.tillyName !== '???' && !seen.has(item.tillyName)) { names.push({ name: item.tillyName, source: 'TillyG' }); seen.add(item.tillyName); }
      // From each variant
      ALL_VARIANT_IDS.forEach(vid => {
        const v = variantsMap[vid];
        if (!v || vid === 'as-is') return;
        const rn = v.renames?.[itemId];
        if (rn && !seen.has(rn)) { names.push({ name: rn, source: v.name }); seen.add(rn); }
      });
      return names;
    }

    function showNameSuggest(input, itemId) {
      closeSuggest();
      const variants = buildNameVariants(itemId);
      if (variants.length <= 1) return;
      const dropdown = document.createElement('div');
      dropdown.className = 'name-suggest';
      dropdown.id = 'nameSuggestDropdown';
      variants.forEach(v => {
        const opt = document.createElement('div');
        opt.className = 'name-suggest-item';
        opt.innerHTML = `<span class="suggest-name">${esc(v.name)}</span><span class="suggest-source">${esc(v.source)}</span>`;
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = v.name;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          closeSuggest();
        });
        dropdown.appendChild(opt);
      });
      input.parentElement.appendChild(dropdown);
    }

    function closeSuggest() {
      const existing = document.getElementById('nameSuggestDropdown');
      if (existing) existing.remove();
    }

    // Remove entry (group or link at top level)
    customView.querySelectorAll('[data-remove-entry]').forEach(btn => {
      if (btn.dataset.removeId) return; // skip child item removes
      btn.addEventListener('click', () => {
        const ei = parseInt(btn.dataset.removeEntry);
        if (state.custom?.entries[ei]) {
          state.custom.entries.splice(ei, 1);
          saveCustom();
          renderCustom();
        }
      });
    });

    // Remove item from group
    customView.querySelectorAll('[data-remove-id][data-remove-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.removeId;
        const ei = parseInt(btn.dataset.removeGroup);
        if (state.custom?.entries[ei]?.type === 'group') {
          state.custom.entries[ei].items = state.custom.entries[ei].items.filter(it => it.id !== itemId);
          saveCustom();
          renderCustom();
        }
      });
    });

    // === DRAG AND DROP ===

    // Source items dragstart
    customView.querySelectorAll('.custom-src-item[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-menu-item', JSON.stringify({
          source: 'panel',
          id: el.dataset.srcId,
          type: el.dataset.srcType
        }));
        e.dataTransfer.effectAllowed = 'copyMove';
        el.style.opacity = '0.4';
      });
      el.addEventListener('dragend', () => { el.style.opacity = ''; });
    });

    // Target items – draggable via handle only
    customView.querySelectorAll('.custom-tgt-item').forEach(el => {
      // Make the entire item draggable but only visually initiate from handle
      el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', (e) => {
        // Block drag if started from an input
        if (e.target.tagName === 'INPUT') { e.preventDefault(); return; }
        el.classList.add('dragging');
        e.dataTransfer.setData('application/x-menu-item', JSON.stringify({
          source: 'target',
          id: el.dataset.tgtId,
          zone: el.dataset.tgtZone,
          idx: el.dataset.tgtIdx
        }));
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); clearDropIndicators(); });
      // Prevent inputs from starting drags
      el.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('mousedown', (e) => e.stopPropagation());
      });
    });

    // Drop indicator management
    function clearDropIndicators() {
      customView.querySelectorAll('.drop-indicator').forEach(el => el.remove());
      customView.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    }

    function showDropIndicator(zone, e) {
      clearDropIndicators();
      zone.classList.add('drag-over');
      // For item-level zones (group-N), show indicator between items
      const targetItem = e.target.closest('.custom-tgt-item');
      if (targetItem && zone.contains(targetItem)) {
        const rect = targetItem.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        if (e.clientY < midY) {
          targetItem.before(indicator);
        } else {
          targetItem.after(indicator);
        }
        return;
      }
      // For entries zone, show indicator between top-level entries
      const targetEntry = e.target.closest('[data-tgt-entry-idx]');
      if (targetEntry && zone.contains(targetEntry)) {
        const rect = targetEntry.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        if (e.clientY < midY) {
          targetEntry.before(indicator);
        } else {
          targetEntry.after(indicator);
        }
        return;
      }
      // Fallback: end of zone
      const lastChild = zone.lastElementChild;
      if (lastChild) {
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        lastChild.after(indicator);
      }
    }

    // Drop zones – all elements with data-drop-zone
    customView.querySelectorAll('[data-drop-zone]').forEach(zone => {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        showDropIndicator(zone, e);
      });
      zone.addEventListener('dragleave', (e) => {
        if (!zone.contains(e.relatedTarget)) clearDropIndicators();
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearDropIndicators();

        let data;
        try { data = JSON.parse(e.dataTransfer.getData('application/x-menu-item')); } catch { return; }

        if (!state.custom) state.custom = { entries: [] };
        if (!state.custom.entries) state.custom.entries = [];
        const zoneName = zone.dataset.dropZone;
        const customIds = getCustomItemIds();

        // Calculate drop index
        let dropIdx = -1;
        const targetItem = e.target.closest('.custom-tgt-item');
        if (targetItem && targetItem.dataset.tgtIdx !== undefined) {
          const rect = targetItem.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          dropIdx = parseInt(targetItem.dataset.tgtIdx);
          if (e.clientY > midY) dropIdx += 1;
        }

        if (data.source === 'panel') {
          if (customIds.has(data.id)) return;

          if (zoneName === 'entries') {
            // Drop from source to top level → create a link entry
            const targetEntry = e.target.closest('[data-tgt-entry-idx]');
            let entryIdx = state.custom.entries.length;
            if (targetEntry) {
              entryIdx = parseInt(targetEntry.dataset.tgtEntryIdx);
              const rect = targetEntry.getBoundingClientRect();
              if (e.clientY > rect.top + rect.height / 2) entryIdx += 1;
            }
            state.custom.entries.splice(entryIdx, 0, { type: 'link', id: data.id, customName: null });
          } else if (zoneName.startsWith('group-')) {
            const ei = parseInt(zoneName.split('-')[1]);
            if (state.custom.entries[ei]?.type === 'group') {
              const newItem = { id: data.id, customName: null };
              if (dropIdx >= 0 && dropIdx <= state.custom.entries[ei].items.length) {
                state.custom.entries[ei].items.splice(dropIdx, 0, newItem);
              } else {
                state.custom.entries[ei].items.push(newItem);
              }
            }
          }
        } else if (data.source === 'target') {
          // Save customName before removing
          let savedCustomName = null;
          if (data.zone.startsWith('group-')) {
            const oldEi = parseInt(data.zone.split('-')[1]);
            if (state.custom.entries[oldEi]?.type === 'group') {
              const oldItem = state.custom.entries[oldEi].items.find(it => it.id === data.id);
              if (oldItem) savedCustomName = oldItem.customName;
            }
          }

          // Remove from old position
          if (data.zone.startsWith('group-')) {
            const oldEi = parseInt(data.zone.split('-')[1]);
            if (state.custom.entries[oldEi]?.type === 'group') {
              state.custom.entries[oldEi].items = state.custom.entries[oldEi].items.filter(it => it.id !== data.id);
            }
          }

          // Adjust drop index if same group
          if (data.zone === zoneName && dropIdx >= 0) {
            const oldIdx = parseInt(data.idx);
            if (oldIdx < dropIdx) dropIdx -= 1;
          }

          // Add to new position
          if (zoneName === 'entries') {
            // Promote child item to top-level link entry
            const targetEntry = e.target.closest('[data-tgt-entry-idx]');
            let entryIdx = state.custom.entries.length;
            if (targetEntry) {
              entryIdx = parseInt(targetEntry.dataset.tgtEntryIdx);
              const rect = targetEntry.getBoundingClientRect();
              if (e.clientY > rect.top + rect.height / 2) entryIdx += 1;
            }
            state.custom.entries.splice(entryIdx, 0, { type: 'link', id: data.id, customName: savedCustomName });
          } else if (zoneName.startsWith('group-')) {
            const newEi = parseInt(zoneName.split('-')[1]);
            if (state.custom.entries[newEi]?.type === 'group') {
              const newItem = { id: data.id, customName: savedCustomName };
              if (dropIdx >= 0 && dropIdx <= state.custom.entries[newEi].items.length) {
                state.custom.entries[newEi].items.splice(dropIdx, 0, newItem);
              } else {
                state.custom.entries[newEi].items.push(newItem);
              }
            }
          }
        }

        saveCustom();
        renderCustom();
      });
    });

    // Entry-level drop bars – wide targets between groups/links for easy dropping
    customView.querySelectorAll('.entry-drop-bar').forEach(bar => {
      bar.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        bar.classList.add('active');
      });
      bar.addEventListener('dragleave', () => bar.classList.remove('active'));
      bar.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        bar.classList.remove('active');
        const targetIdx = parseInt(bar.dataset.entryDrop);

        // Handle item drops (from source or from within a group)
        let itemData;
        try { itemData = JSON.parse(e.dataTransfer.getData('application/x-menu-item')); } catch {}
        if (itemData && state.custom?.entries) {
          const customIds = getCustomItemIds();
          if (itemData.source === 'panel') {
            if (customIds.has(itemData.id)) return;
            state.custom.entries.splice(targetIdx, 0, { type: 'link', id: itemData.id, customName: null });
          } else if (itemData.source === 'target') {
            // Remove from old group
            let savedCustomName = null;
            if (itemData.zone?.startsWith('group-')) {
              const oldEi = parseInt(itemData.zone.split('-')[1]);
              if (state.custom.entries[oldEi]?.type === 'group') {
                const old = state.custom.entries[oldEi].items.find(it => it.id === itemData.id);
                if (old) savedCustomName = old.customName;
                state.custom.entries[oldEi].items = state.custom.entries[oldEi].items.filter(it => it.id !== itemData.id);
              }
            }
            state.custom.entries.splice(targetIdx, 0, { type: 'link', id: itemData.id, customName: savedCustomName });
          }
          saveCustom();
          renderCustom();
          return;
        }

        // Handle entry reorder drops
        let entryData;
        try { entryData = JSON.parse(e.dataTransfer.getData('application/x-menu-entry')); } catch {}
        if (entryData?.source === 'entry-reorder' && state.custom?.entries) {
          let fromIdx = entryData.idx;
          let toIdx = targetIdx;
          if (fromIdx < toIdx) toIdx -= 1;
          if (fromIdx !== toIdx && fromIdx >= 0 && toIdx >= 0) {
            const [moved] = state.custom.entries.splice(fromIdx, 1);
            state.custom.entries.splice(toIdx, 0, moved);
            saveCustom();
            renderCustom();
          }
        }
      });
    });

    // Entry reordering (groups and top-level links) – from header drag handle
    customView.querySelectorAll('[data-tgt-entry-idx]').forEach(el => {
      const handle = el.querySelector('.drag-handle') || (el.matches('.custom-tgt-entry-link') ? el : null);
      if (!handle) return;
      if (el.matches('.custom-tgt-group')) el.setAttribute('draggable', 'false');
      handle.setAttribute('draggable', 'true');
      handle.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('application/x-menu-entry', JSON.stringify({
          source: 'entry-reorder',
          idx: parseInt(el.dataset.tgtEntryIdx)
        }));
        e.dataTransfer.effectAllowed = 'move';
        el.style.opacity = '0.4';
      });
      handle.addEventListener('dragend', () => { el.style.opacity = ''; clearDropIndicators(); });
    });

    // Entry-level drop target (the entries container)
    const entriesZone = customView.querySelector('[data-drop-zone="entries"]');
    if (entriesZone) {
      entriesZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        // Show drop indicator between entries
        clearDropIndicators();
        const targetEntry = e.target.closest('[data-tgt-entry-idx]');
        if (targetEntry) {
          const rect = targetEntry.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const indicator = document.createElement('div');
          indicator.className = 'drop-indicator';
          indicator.style.height = '3px';
          if (e.clientY < midY) {
            targetEntry.before(indicator);
          } else {
            targetEntry.after(indicator);
          }
        }
      });
      entriesZone.addEventListener('dragleave', (e) => {
        if (!entriesZone.contains(e.relatedTarget)) clearDropIndicators();
      });
      entriesZone.addEventListener('drop', (e) => {
        clearDropIndicators();
        let data;
        try { data = JSON.parse(e.dataTransfer.getData('application/x-menu-entry')); } catch { return; }

        if (data.source === 'entry-reorder' && state.custom?.entries) {
          const targetEntry = e.target.closest('[data-tgt-entry-idx]');
          if (targetEntry) {
            const fromIdx = data.idx;
            let toIdx = parseInt(targetEntry.dataset.tgtEntryIdx);
            const rect = targetEntry.getBoundingClientRect();
            if (e.clientY > rect.top + rect.height / 2) toIdx += 1;
            if (fromIdx < toIdx) toIdx -= 1;
            if (fromIdx !== toIdx && fromIdx >= 0 && toIdx >= 0) {
              const [moved] = state.custom.entries.splice(fromIdx, 1);
              state.custom.entries.splice(toIdx, 0, moved);
              saveCustom();
              renderCustom();
            }
          }
        }
      });
    }
  }

  // ===== DECISION TRACKER =====
  function saveDecisions() {
    localStorage.setItem('menuDemoDecisions', JSON.stringify(state.decisions));
    saveToServer('decisions', state.decisions);
  }

  function extractName(suggestion) {
    const match = suggestion.match(/"([^"]+)"/);
    return match ? match[1] : suggestion.split('\u2014')[0].trim();
  }

  function generateDecisions() {
    const decisions = state.decisions;

    items.forEach(item => {
      if (item.type === 'group') return;

      // Naming decisions: items with different names across variants
      const names = {};
      ALL_DECISION_IDS.forEach(vid => {
        const v = variantsMap[vid];
        if (!v) return;
        const dn = getDisplayName(item.id, v);
        if (!names[dn]) names[dn] = [];
        names[dn].push(vid);
      });
      if (Object.keys(names).length > 1) {
        const key = item.id + '_naming';
        if (!decisions[key]) {
          decisions[key] = {
            type: 'naming',
            itemId: item.id,
            status: item.rationale?.namingSuggestion ? 'proposed' : 'open',
            decision: item.rationale?.namingSuggestion ? extractName(item.rationale.namingSuggestion) : '',
            proposedBy: item.rationale?.namingSuggestion ? 'Claude' : '',
            notes: '',
            options: names,
            timestamp: new Date().toISOString()
          };
        } else {
          decisions[key].options = names;
        }
      }

      // Placement decisions: items with different parents across variants
      const placements = {};
      ALL_DECISION_IDS.forEach(vid => {
        const v = variantsMap[vid];
        if (!v) return;
        const parent = getItemParentInVariant(item.id, v);
        if (parent && parent !== '(top-level link)') {
          if (!placements[parent]) placements[parent] = [];
          placements[parent].push(vid);
        }
      });
      if (Object.keys(placements).length > 1) {
        const key = item.id + '_placement';
        if (!decisions[key]) {
          decisions[key] = {
            type: 'placement',
            itemId: item.id,
            status: item.rationale?.currentChoice ? 'proposed' : 'open',
            decision: item.rationale?.currentChoice || '',
            proposedBy: item.rationale?.currentChoice ? 'Claude' : '',
            notes: '',
            options: placements,
            timestamp: new Date().toISOString()
          };
        } else {
          decisions[key].options = placements;
        }
      }

      // Open question decisions
      if (item.rationale?.openQuestion) {
        const key = item.id + '_question';
        if (!decisions[key]) {
          decisions[key] = {
            type: item.rationale.openQuestion.toLowerCase().includes('name') || item.rationale.openQuestion.toLowerCase().includes('rename') ? 'naming' : 'placement',
            itemId: item.id,
            status: 'open',
            decision: '',
            proposedBy: '',
            notes: '',
            question: item.rationale.openQuestion,
            timestamp: new Date().toISOString()
          };
        }
      }

      // Removal decisions: items removed in some variants but not others
      const removedIn = [];
      const keptIn = [];
      ALL_DECISION_IDS.forEach(vid => {
        const v = variantsMap[vid];
        if (!v || vid === 'as-is') return;
        if (v.removed?.includes(item.id)) removedIn.push(vid);
        else keptIn.push(vid);
      });
      if (removedIn.length > 0 && keptIn.length > 0) {
        const key = item.id + '_removal';
        if (!decisions[key]) {
          decisions[key] = {
            type: 'removal',
            itemId: item.id,
            status: 'open',
            decision: '',
            proposedBy: '',
            notes: '',
            options: { 'Keep': keptIn, 'Remove': removedIn },
            timestamp: new Date().toISOString()
          };
        }
      }
    });

    // Group-level structural decisions: group names that differ across variants
    const groupNamesAcross = {};
    ALL_DECISION_IDS.forEach(vid => {
      const v = variantsMap[vid];
      if (!v || vid === 'as-is') return;
      const entries = buildEntries(v);
      entries.forEach(entry => {
        if (entry.type === 'group') {
          const gName = entry.group.name;
          // Normalize to find equivalent groups by item overlap
          const gItems = new Set(getAllGroupItemIds(entry.group));
          // Find the As-Is equivalent
          const asIs = variantsMap['as-is'];
          if (asIs) {
            const asIsEntries = buildEntries(asIs);
            asIsEntries.forEach(ae => {
              if (ae.type !== 'group') return;
              const aeItems = new Set(getAllGroupItemIds(ae.group));
              const overlap = [...gItems].filter(id => aeItems.has(id)).length;
              const maxSize = Math.max(gItems.size, aeItems.size);
              if (maxSize > 0 && overlap / maxSize > 0.4) {
                // These are equivalent groups
                const baseKey = 'group_' + ae.group.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                if (!groupNamesAcross[baseKey]) groupNamesAcross[baseKey] = { asIsName: ae.group.name, names: {} };
                if (!groupNamesAcross[baseKey].names[gName]) groupNamesAcross[baseKey].names[gName] = [];
                groupNamesAcross[baseKey].names[gName].push(vid);
              }
            });
          }
        }
      });
    });

    // Create structural decisions for groups with multiple names
    Object.entries(groupNamesAcross).forEach(([baseKey, data]) => {
      // Add As-Is name
      if (!data.names[data.asIsName]) data.names[data.asIsName] = [];
      data.names[data.asIsName].push('as-is');

      if (Object.keys(data.names).length > 1) {
        const key = baseKey + '_groupname';
        if (!decisions[key]) {
          decisions[key] = {
            type: 'structural',
            itemId: baseKey,
            itemName: 'Group: ' + data.asIsName,
            status: 'open',
            decision: '',
            proposedBy: '',
            notes: '',
            options: data.names,
            question: `What should the "${data.asIsName}" group be called? Different variants use different names.`,
            timestamp: new Date().toISOString()
          };
        } else {
          decisions[key].options = data.names;
        }
      }
    });

    // Remove item-level open questions that are really about group naming
    // (e.g., Segments' question about Contacts vs Audience is a group decision)
    const groupQuestionItems = ['segments', 'contacts_page'];
    groupQuestionItems.forEach(id => {
      const qKey = id + '_question';
      if (decisions[qKey] && decisions[qKey].question?.includes('group')) {
        delete decisions[qKey];
      }
    });

    state.decisions = decisions;
    saveDecisions();
  }

  function renderDecisions() {
    generateDecisions();
    const scrollEl = decisionsView.querySelector('.decisions-scroll');
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    const decisions = state.decisions;
    const filter = state.decisionFilter;

    // Collect decision entries
    let entries = Object.entries(decisions);

    // Filter
    if (filter === 'open') entries = entries.filter(([, d]) => d.status === 'open');
    else if (filter === 'proposed') entries = entries.filter(([, d]) => d.status === 'proposed');
    else if (filter === 'approved') entries = entries.filter(([, d]) => d.status === 'approved');
    else if (filter === 'deferred') entries = entries.filter(([, d]) => d.status === 'deferred');
    else if (filter === 'skipped') entries = entries.filter(([, d]) => d.status === 'skipped');
    else if (filter === 'naming') entries = entries.filter(([, d]) => d.type === 'naming');
    else if (filter === 'placement') entries = entries.filter(([, d]) => d.type === 'placement');
    else if (filter === 'removal') entries = entries.filter(([, d]) => d.type === 'removal');
    else if (filter === 'structural') entries = entries.filter(([, d]) => d.type === 'structural');
    else if (filter === 'debated') entries = entries.filter(([, d]) => {
      if (d.type === 'placement' && d.options && Object.keys(d.options).length <= 1) return false;
      if (d.type === 'naming' && d.options && Object.keys(d.options).length <= 1) return false;
      return true;
    });

    // Sort: open first, then proposed, then approved, then deferred; within each, by UPV desc
    const statusOrder = { open: 0, proposed: 1, approved: 2, deferred: 3, skipped: 4 };
    entries.sort((a, b) => {
      const sa = statusOrder[a[1].status] ?? 2;
      const sb = statusOrder[b[1].status] ?? 2;
      if (sa !== sb) return sa - sb;
      const upvA = itemsMap[a[1].itemId]?.upv || 0;
      const upvB = itemsMap[b[1].itemId]?.upv || 0;
      return upvB - upvA;
    });

    // Progress stats
    const allEntries = Object.values(decisions);
    const totalCount = allEntries.length;
    const approvedCount = allEntries.filter(d => d.status === 'approved').length;
    const openCount = allEntries.filter(d => d.status === 'open').length;
    const proposedCount = allEntries.filter(d => d.status === 'proposed').length;
    const deferredCount = allEntries.filter(d => d.status === 'deferred').length;
    const skippedCount = allEntries.filter(d => d.status === 'skipped').length;
    const progressPct = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0;

    // Items that need email dependency note
    const emailDepItems = ['link_categories', 'bounce_mail_management', 'frequency_cap', 'internal_blacklist', 'sms_settings'];

    let html = '';

    // Toolbar
    html += '<div class="decisions-toolbar">';
    html += '<div class="decisions-progress">';
    html += `<div class="decisions-progress-label">${approvedCount} of ${totalCount} decided (${progressPct}%) \u2014 ${openCount} open, ${proposedCount} proposed, ${skippedCount} skipped, ${deferredCount} deferred</div>`;
    html += `<div class="decisions-progress-bar"><div class="decisions-progress-fill" style="width:${progressPct}%"></div></div>`;
    html += '</div>';
    html += '<div class="decisions-filter">';
    const filters = [
      ['all', 'All (' + totalCount + ')'],
      ['open', 'Open (' + openCount + ')'],
      ['proposed', 'Proposed (' + proposedCount + ')'],
      ['approved', 'Approved (' + approvedCount + ')'],
      ['deferred', 'Deferred (' + deferredCount + ')'],
      ['skipped', 'Skipped (' + skippedCount + ')'],
      ['naming', 'Naming'],
      ['placement', 'Placement'],
      ['removal', 'Removal'],
      ['structural', 'Structural'],
      ['debated', 'Debated Only']
    ];
    filters.forEach(([key, label]) => {
      html += `<button class="decisions-filter-btn${filter === key ? ' active' : ''}" data-dfilter="${key}">${label}</button>`;
    });
    html += '</div>';
    html += '<button class="btn-export-decisions" id="btnExportDecisions">Export JSON</button>';
    html += '</div>';

    // Group entries by itemId for combined display
    const grouped = new Map();
    entries.forEach(([key, d]) => {
      const gid = d.itemId || key;
      if (!grouped.has(gid)) grouped.set(gid, []);
      grouped.get(gid).push([key, d]);
    });

    // Cards – one per item, sub-sections for each decision type
    html += '<div class="decisions-scroll">';

    if (grouped.size === 0) {
      html += '<div style="text-align:center;padding:40px;color:#8D9094;font-size:14px">No decisions match the current filter.</div>';
    }

    grouped.forEach((itemEntries, gid) => {
      const firstD = itemEntries[0][1];
      const item = itemsMap[firstD.itemId];
      const isStructural = firstD.type === 'structural';
      const itemName = firstD.itemName || item?.name || firstD.itemId;
      if (!item && !isStructural) return;
      const upv = item?.upv ? fmt(item.upv) : '\u2014';
      const allApproved = itemEntries.every(([,d]) => d.status === 'approved');
      const anyDeferred = itemEntries.some(([,d]) => d.status === 'deferred');
      const statusCls = allApproved ? ' status-approved' : anyDeferred ? ' status-deferred' : '';

      html += `<div class="decision-card${statusCls}">`;

      // Item header
      html += '<div class="decision-card-header">';
      const typeBadges = itemEntries.map(([,d]) => `<span class="decision-type-badge decision-type-${d.type}">${d.type}</span>`).join('');
      html += typeBadges;
      html += `<span class="decision-item-name">${esc(itemName)}</span>`;
      html += `<span class="decision-item-meta">UPV: ${upv}</span>`;
      html += '</div>';

      // Reviewer comments (once per item, not per sub-decision)
      const comments = [];
      if (item?.petiComment) comments.push('Peti: ' + item.petiComment);
      if (item?.tillyCom && item.tillyCom.length > 0) comments.push('TillyG: ' + item.tillyCom);
      if (comments.length > 0) {
        html += `<div class="decision-card-body"><div class="decision-comments">${comments.map(c => esc(c)).join('<br>')}</div></div>`;
      }

      // SAP category (once per item)
      if (item?.rationale?.officialCategory) {
        html += `<div class="decision-card-body"><div class="decision-sap">SAP category: ${esc(item.rationale.officialCategory)}</div></div>`;
      }

      // Sub-sections – one per decision type
      itemEntries.forEach(([key, d]) => {
        html += `<div class="decision-card-body" data-dkey="${esc(key)}" style="border-top:1px solid #F0F0F0;padding-top:8px;margin-top:4px">`;
        html += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#8D9094;margin-bottom:4px;display:flex;align-items:center;gap:8px">${d.type} <select class="decision-status" data-dstatus="${esc(key)}" style="font-size:10px;padding:1px 4px">`;
        ['open', 'proposed', 'approved', 'deferred'].forEach(s => {
          html += `<option value="${s}"${d.status === s ? ' selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`;
        });
        html += '</select></div>';

        if (d.question) {
          html += `<div class="decision-dep-note" style="background:#FFF8E1;border-left-color:#F9A825;margin-bottom:10px"><strong>Open question:</strong> ${esc(d.question)}</div>`;
        }

        if (d.options && Object.keys(d.options).length > 0) {
          html += '<div class="decision-options">';
          Object.entries(d.options).forEach(([optName, optVariants]) => {
            const isSelected = d.decision === optName;
            const variantLabels = (Array.isArray(optVariants) ? optVariants : []).map(vid => { const vr = variantsMap[vid]; return vr ? vr.name : vid; }).join(', ');
            html += `<div class="decision-option${isSelected ? ' selected' : ''}" data-dopt="${esc(key)}" data-dopt-val="${esc(optName)}">`;
            html += `<div class="decision-option-name">${esc(optName)}</div>`;
            if (variantLabels) html += `<div class="decision-option-source">${esc(variantLabels)}</div>`;
            html += '</div>';
          });
          html += '</div>';
        }

        if (item?.rationale?.namingSuggestion && d.type === 'naming') {
          html += `<div class="decision-rec"><strong>Recommendation:</strong> ${esc(item.rationale.namingSuggestion)}</div>`;
        }
        if (item?.rationale?.currentChoice && d.type === 'placement') {
          html += `<div class="decision-rec"><strong>Current decision:</strong> ${esc(item.rationale.currentChoice)}</div>`;
        }

        if (emailDepItems.includes(d.itemId) && d.type === 'naming') {
          html += '<div class="decision-dep-note">Naming depends on parent group decision: if placed under "Email," the "Email" prefix may be redundant.</div>';
        }

        html += '<div class="decision-card-footer">';
        html += `<button class="decision-approve-btn" data-dapprove="${esc(key)}">${d.status === 'approved' ? '\u2713 Approved' : 'Approve'}</button>`;
        html += `<button class="decision-defer-btn" data-ddefer="${esc(key)}">${d.status === 'deferred' ? 'Deferred' : 'Defer'}</button>`;
        html += `<button class="decision-skip-btn" data-dskip="${esc(key)}">${d.status === 'skipped' ? 'Skipped' : 'Skip'}</button>`;
        html += '</div>';

        html += '</div>';
      });

      // Notes section (per item, shared)
      const firstKey = itemEntries[0][0];
      const firstNotes = itemEntries[0][1].notes;
      const notesArr = Array.isArray(firstNotes) ? firstNotes : (typeof firstNotes === 'string' && firstNotes ? [{ text: firstNotes, author: 'TillyG', time: itemEntries[0][1].timestamp }] : []);
      html += '<div class="decision-notes-section">';
      notesArr.forEach(note => {
        const timeStr = note.time ? new Date(note.time).toLocaleDateString('en-GB', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
        html += `<div class="decision-note"><div class="decision-note-header"><strong>${esc(note.author || 'Anonymous')}</strong><span class="decision-note-time">${timeStr}</span></div><div class="decision-note-text">${esc(note.text)}</div></div>`;
      });
      html += `<div class="decision-note-add"><input class="decision-note-input" placeholder="Add a note..." data-dnote-key="${esc(firstKey)}"><button class="decision-note-btn" data-dnote-add="${esc(firstKey)}">Post</button></div>`;
      html += '</div>';

      html += '</div>';
    });

    html += '</div>';

    decisionsView.innerHTML = html;
    const newScrollEl = decisionsView.querySelector('.decisions-scroll');
    if (newScrollEl) newScrollEl.scrollTop = scrollTop;

    // Attach events

    // Filter buttons
    decisionsView.querySelectorAll('.decisions-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.decisionFilter = btn.dataset.dfilter;
        renderDecisions();
      });
    });

    // Status dropdowns
    decisionsView.querySelectorAll('.decision-status').forEach(sel => {
      sel.addEventListener('change', () => {
        const key = sel.dataset.dstatus;
        if (state.decisions[key]) {
          state.decisions[key].status = sel.value;
          saveDecisions();
          renderDecisions();
        }
      });
    });

    // Option clicks
    decisionsView.querySelectorAll('.decision-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const key = opt.dataset.dopt;
        const val = opt.dataset.doptVal;
        if (state.decisions[key]) {
          if (state.decisions[key].decision === val) {
            state.decisions[key].decision = '';
          } else {
            state.decisions[key].decision = val;
          }
          saveDecisions();
          renderDecisions();
        }
      });
    });

    // Approve buttons
    decisionsView.querySelectorAll('.decision-approve-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.dapprove;
        if (state.decisions[key]) {
          state.decisions[key].status = state.decisions[key].status === 'approved' ? 'proposed' : 'approved';
          saveDecisions();
          renderDecisions();
        }
      });
    });

    // Defer buttons
    decisionsView.querySelectorAll('.decision-defer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.ddefer;
        if (state.decisions[key]) {
          state.decisions[key].status = state.decisions[key].status === 'deferred' ? 'open' : 'deferred';
          saveDecisions();
          renderDecisions();
        }
      });
    });

    // Skip buttons
    decisionsView.querySelectorAll('.decision-skip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.dskip;
        if (state.decisions[key]) {
          state.decisions[key].status = state.decisions[key].status === 'skipped' ? 'open' : 'skipped';
          saveDecisions();
          renderDecisions();
        }
      });
    });

    // Post note button
    decisionsView.querySelectorAll('.decision-note-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.dnoteAdd;
        const input = decisionsView.querySelector(`[data-dnote-key="${key}"]`);
        if (!input || !input.value.trim()) return;
        if (state.decisions[key]) {
          if (!Array.isArray(state.decisions[key].notes)) state.decisions[key].notes = [];
          state.decisions[key].notes.push({
            text: input.value.trim(),
            author: sessionStorage.getItem('menuUserName') || 'Anonymous',
            time: new Date().toISOString()
          });
          saveDecisions();
          renderDecisions();
        }
      });
    });
    // Also post on Enter key
    decisionsView.querySelectorAll('.decision-note-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const key = input.dataset.dnoteKey;
          const btn = decisionsView.querySelector(`[data-dnote-add="${key}"]`);
          if (btn) btn.click();
        }
      });
    });

    // Export
    const exportBtn = document.getElementById('btnExportDecisions');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const exportData = {};
        Object.entries(state.decisions).forEach(([key, d]) => {
          const item = itemsMap[d.itemId];
          exportData[key] = {
            itemName: item?.name || d.itemId,
            type: d.type,
            status: d.status,
            decision: d.decision,
            notes: d.notes,
            question: d.question || null,
            options: d.options
          };
        });
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'decisions-export.json'; a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  // ===== VARIANT CONTEXT MENU =====
  function showVariantMenu(trigger, vid) {
    closeVariantMenu();
    const menu = document.createElement('div');
    menu.className = 'variant-menu';
    menu.id = 'variantMenuDropdown';

    const isStarred = state.starred.has(vid);

    menu.innerHTML = `
      <button class="variant-menu-item" data-vmaction="edit" data-vmvid="${vid}">\u270F\uFE0F Edit</button>
      <button class="variant-menu-item" data-vmaction="shortlist" data-vmvid="${vid}">${isStarred ? '\u2605 Remove from Shortlist' : '\u2606 Add to Shortlist'}</button>
      <button class="variant-menu-item" data-vmaction="download" data-vmvid="${vid}">\uD83D\uDCE5 Download JSON</button>
      <button class="variant-menu-item" data-vmaction="duplicate" data-vmvid="${vid}">\uD83D\uDCCB Duplicate</button>
      <div class="variant-menu-divider"></div>
      <button class="variant-menu-item" data-vmaction="archive" data-vmvid="${vid}">\uD83D\uDCE6 Archive</button>
      <button class="variant-menu-item variant-menu-danger" data-vmaction="delete" data-vmvid="${vid}">\uD83D\uDDD1\uFE0F Delete</button>
    `;

    // Position below trigger
    const rect = trigger.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '1000';

    document.body.appendChild(menu);

    // Handle actions
    menu.querySelectorAll('.variant-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.vmaction;
        const targetVid = item.dataset.vmvid;
        handleVariantAction(action, targetVid);
        closeVariantMenu();
      });
    });

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', closeVariantMenu, { once: true });
    }, 10);
  }

  function closeVariantMenu() {
    const existing = document.getElementById('variantMenuDropdown');
    if (existing) existing.remove();
  }

  function handleVariantAction(action, vid) {
    const v = variantsMap[vid];
    if (!v) return;

    switch(action) {
      case 'edit':
        // Trigger the edit variant flow
        state.editingVariantId = vid;
        state.editOriginal = JSON.parse(JSON.stringify(v));
        const builtEntries = buildEntries(v);
        const entries = builtEntries.map(entry => {
          if (entry.type === 'link') return { type: 'link', id: entry.id, customName: v.renames?.[entry.id] || null };
          if (entry.type === 'separator') return { type: 'separator', label: entry.label };
          if (entry.type === 'footer-start') return { type: 'footer-start' };
          return { type: 'group', name: entry.group.name, items: getAllGroupItemIds(entry.group).filter(id => !v.removed?.includes(id)).map(id => ({ id, customName: v.renames?.[id] || null })) };
        });
        state.custom = { entries };
        customOverlay.style.display = 'flex';
        customOverlay.classList.add('active');
        renderCustom();
        break;

      case 'shortlist':
        if (state.starred.has(vid)) state.starred.delete(vid);
        else state.starred.add(vid);
        localStorage.setItem('menuDemoStarred', JSON.stringify([...state.starred]));
        updateSubToggle();
        break;

      case 'download':
        const blob = new Blob([JSON.stringify(v, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `variant-${vid}.json`; a.click();
        URL.revokeObjectURL(url);
        break;

      case 'duplicate':
        const newId = vid + '-copy-' + Date.now();
        const copy = JSON.parse(JSON.stringify(v));
        copy.id = newId;
        copy.name = v.name + ' (Copy)';
        variantsMap[newId] = copy;
        ALL_VARIANT_IDS.push(newId);
        const nextKey = String(Object.keys(TAB_MAP['ux']).length + 1);
        TAB_MAP['ux'][nextKey] = newId;
        SUB_LABELS['ux'][nextKey] = copy.name;
        updateSubToggle();
        // Save to server
        fetch(`/save/variant/${newId}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(copy) }).catch(() => {});
        break;

      case 'archive':
        if (!confirm(`Archive "${v.name}"? It will be hidden but can be restored.`)) return;
        const archivedList = JSON.parse(localStorage.getItem('menuDemoArchived') || '[]');
        archivedList.push({ id: vid, name: v.name, timestamp: new Date().toISOString() });
        localStorage.setItem('menuDemoArchived', JSON.stringify(archivedList));
        // Remove from TAB_MAP
        for (const [k, id] of Object.entries(TAB_MAP['ux'])) {
          if (id === vid) { delete TAB_MAP['ux'][k]; break; }
        }
        // Reindex TAB_MAP
        const remaining = Object.values(TAB_MAP['ux']);
        TAB_MAP['ux'] = {};
        SUB_LABELS['ux'] = {};
        remaining.forEach((id, i) => {
          TAB_MAP['ux'][String(i+1)] = id;
          const vr = variantsMap[id];
          SUB_LABELS['ux'][String(i+1)] = vr ? vr.name : id;
        });
        // Switch to first variant if current was archived
        if (currentVariantId() === vid) { state.sub = '1'; render(); }
        updateSubToggle();
        break;

      case 'delete':
        if (!confirm(`Delete "${v.name}"? This cannot be undone.`)) return;
        // Remove from TAB_MAP
        for (const [k, id] of Object.entries(TAB_MAP['ux'])) {
          if (id === vid) { delete TAB_MAP['ux'][k]; break; }
        }
        const rem2 = Object.values(TAB_MAP['ux']);
        TAB_MAP['ux'] = {};
        SUB_LABELS['ux'] = {};
        rem2.forEach((id, i) => {
          TAB_MAP['ux'][String(i+1)] = id;
          const vr = variantsMap[id];
          SUB_LABELS['ux'][String(i+1)] = vr ? vr.name : id;
        });
        delete variantsMap[vid];
        if (currentVariantId() === vid) { state.sub = '1'; render(); }
        updateSubToggle();
        break;
    }
  }

  // ===== HELPERS =====
  function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function fmt(n) { return n != null ? n.toLocaleString() : '—'; }

  // ===== INITIAL RENDER =====
  updateSubToggle();
  render();
  generateDecisions();

  // ===== WALKTHROUGH =====
  if (!localStorage.getItem('menuDemoWalkthroughDone')) {
    const steps = [
      { target: '#variantTabs', text: 'Switch between menu proposals using these tabs. The starred ones appear in the Shortlist as our final candidates.' },
      { target: '#sidebar', text: 'Browse the menu structure. Click any item or group to see details, usage analytics, and leave your feedback.' },
      { target: '[data-view="compare"]', text: 'Compare proposals side by side. Click on any item to highlight it across all versions.' },
      { target: '.shell-bar-center', text: 'Use the Shortlist tab for final proposals and the Decisions tab for open naming and placement questions.' },
      { target: '#btnExport', text: 'When you\'re done, click Export Feedback to download your comments as a JSON file. Send it to TillyG for processing.' }
    ];
    let currentStep = 0;
    const overlay = document.getElementById('walkthrough');
    const backdrop = document.getElementById('wtBackdrop');
    const tooltip = document.getElementById('wtTooltip');
    const textEl = document.getElementById('wtText');
    const stepEl = document.getElementById('wtStep');
    const nextBtn = document.getElementById('wtNext');
    const skipBtn = document.getElementById('wtSkip');

    function showStep(idx) {
      const step = steps[idx];
      const el = document.querySelector(step.target);
      if (!el) { endWalkthrough(); return; }
      const rect = el.getBoundingClientRect();
      const pad = 8;

      let spot = overlay.querySelector('.wt-spotlight');
      if (!spot) { spot = document.createElement('div'); spot.className = 'wt-spotlight'; overlay.appendChild(spot); }
      spot.style.top = (rect.top - pad) + 'px';
      spot.style.left = (rect.left - pad) + 'px';
      spot.style.width = (rect.width + pad * 2) + 'px';
      spot.style.height = (rect.height + pad * 2) + 'px';
      backdrop.style.display = 'none';

      textEl.textContent = step.text;
      stepEl.textContent = (idx + 1) + ' / ' + steps.length;
      nextBtn.textContent = idx === steps.length - 1 ? 'Done' : 'Next';

      tooltip.style.visibility = 'hidden';
      tooltip.style.left = '0px';
      tooltip.style.top = '0px';

      requestAnimationFrame(() => {
        const ttRect = tooltip.getBoundingClientRect();
        const ttW = ttRect.width;
        const ttH = ttRect.height;
        const gap = 12;

        let ttLeft, ttTop;
        const spaceBelow = window.innerHeight - rect.bottom - gap;
        const spaceAbove = rect.top - gap;

        if (spaceBelow >= ttH) {
          ttTop = rect.bottom + gap;
        } else if (spaceAbove >= ttH) {
          ttTop = rect.top - ttH - gap;
        } else {
          ttTop = Math.max(16, Math.min(window.innerHeight - ttH - 16, rect.top + rect.height / 2 - ttH / 2));
        }

        ttLeft = rect.left + rect.width / 2 - ttW / 2;
        if (ttLeft < 16) ttLeft = 16;
        if (ttLeft + ttW > window.innerWidth - 16) ttLeft = window.innerWidth - ttW - 16;

        tooltip.style.left = ttLeft + 'px';
        tooltip.style.top = ttTop + 'px';
        tooltip.style.visibility = 'visible';
      });
    }

    function endWalkthrough() {
      overlay.style.display = 'none';
      localStorage.setItem('menuDemoWalkthroughDone', 'true');
    }

    nextBtn.addEventListener('click', () => {
      currentStep++;
      if (currentStep >= steps.length) endWalkthrough();
      else showStep(currentStep);
    });
    skipBtn.addEventListener('click', endWalkthrough);

    overlay.style.display = 'block';
    showStep(0);
  }
})();
