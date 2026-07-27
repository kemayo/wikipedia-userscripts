// ==UserScript==
// @name         Phabricator: move tag + column in one step
// @version      2026-07-27
// @description  Quick move to a specific tag-with-column
// @author       David Lynch
// @namespace    davidlynch.org
// @match        https://phabricator.wikimedia.org/T*
// @match        https://phabricator.wikimedia.org/project/*
// @match        https://phabricator.wikimedia.org/tag/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// On a task: a curtain panel below "Project Tags". On a workboard: a hover
// checkbox on each card; checking any card reveals every card's checkbox and a
// floating panel that loops the edit over the selected set. Each edit is a
// single maniphest.edit: optionally remove one tag, assign to you, and move into
// an arbitrary column. The `column` transaction auto-attaches the destination board.
//
// Auth: session cookies + CSRF header, no stored API token. If Conduit rejects
// the write with an auth (not CSRF) error, add `api.token` to conduit()'s body
// and switch `credentials` to 'omit'.

(function () {
  'use strict';

  const MRU_KEY = 'phab-tagmove-mru';
  const MRU_MAX = 6;

  // --- Conduit -------------------------------------------------------------

  async function conduit(method, params) {
    // CSRF lives in any page form; tokens are session-scoped, so any works.
    const csrf = document.querySelector('input[name="__csrf__"]');
    if (!csrf) throw new Error('No __csrf__ on page. Reload and retry.');
    const res = await fetch(`/api/${method}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Phabricator-Csrf': csrf.value,
      },
      body: new URLSearchParams({ params: JSON.stringify(params), output: 'json' }),
    });
    const json = await res.json();
    if (json.error_code) throw new Error(`${json.error_code}: ${json.error_info}`);
    return json.result;
  }

  // --- Data ----------------------------------------------------------------

  // Removal candidates come from the DOM (no PHIDs there); resolve the chosen
  // one at submit time. Tag links are /tag/<slug>/ or /project/view/<id>/.
  function readTagsFromDom() {
    const out = [];
    document.querySelectorAll('.phabricator-handle-tag-list-item').forEach((li) => {
      const a = li.querySelector('a.phui-tag-view');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      let m, slug = null, pid = null;
      if ((m = href.match(/^\/tag\/([^/]+)\//))) slug = m[1];
      else if ((m = href.match(/\/project\/(?:view|board)\/(\d+)/))) pid = m[1];
      if (slug || pid) out.push({ name: a.textContent.trim(), slug, pid });
    });
    return out;
  }

  async function resolvePHID(slug, pid) {
    const constraints = slug ? { slugs: [slug] } : { ids: [parseInt(pid, 10)] };
    const r = await conduit('project.search', { constraints });
    if (!r.data.length) throw new Error('Could not resolve the tag to remove.');
    return r.data[0].phid;
  }

  // Milestones (sprints) return just their own name; the tag list shows them
  // parent-qualified as "Parent (Sprint)".
  function displayName(f) {
    return f.milestone && f.parent ? `${f.parent.name} (${f.name})` : f.name;
  }

  async function searchProjects(text) {
    const r = await conduit('project.search', { constraints: { query: text }, limit: 10 });
    return r.data.map((d) => ({
      phid: d.phid,
      name: displayName(d.fields),
      color: (d.fields.color && d.fields.color.key) || 'grey',
      icon: (d.fields.icon && d.fields.icon.icon) || null,
    }));
  }

  async function columnsFor(projPHID) {
    const r = await conduit('project.column.search', { constraints: { projects: [projPHID] }, limit: 100 });
    return r.data.map((d) => ({ phid: d.phid, name: d.fields.name, hidden: !!d.fields.isHidden }));
  }

  async function applyMove(target, { removePHID, ownerPHID, columnPHID }) {
    const txns = [];
    if (removePHID) txns.push({ type: 'projects.remove', value: [removePHID] });
    if (ownerPHID) txns.push({ type: 'owner', value: ownerPHID });
    txns.push({ type: 'column', value: columnPHID }); // auto-adds the board
    return conduit('maniphest.edit', { objectIdentifier: target, transactions: txns });
  }

  // Viewer PHID for "claim"; cached since it is constant per session.
  async function viewerPHID() {
    const KEY = 'phab-viewer-phid';
    const cached = localStorage.getItem(KEY);
    if (cached) return cached;
    try {
      const r = await conduit('user.whoami', {});
      if (r && r.phid) { localStorage.setItem(KEY, r.phid); return r.phid; }
    } catch (e) { /* user.whoami unavailable; the claim button stays disabled */ }
    return null;
  }

  // --- MRU (localStorage, per your preference) -----------------------------

  function loadMru() {
    try { return JSON.parse(localStorage.getItem(MRU_KEY)) || []; }
    catch { return []; }
  }
  function pushMru(entry) {
    const mru = loadMru().filter((e) => e.columnPHID !== entry.columnPHID);
    mru.unshift(entry);
    localStorage.setItem(MRU_KEY, JSON.stringify(mru.slice(0, MRU_MAX)));
  }
  function removeMru(columnPHID) {
    localStorage.setItem(MRU_KEY, JSON.stringify(loadMru().filter((e) => e.columnPHID !== columnPHID)));
  }

  // Native list-item markup so rows match the Project Tags section exactly.
  function tagItem({ project: p, columnName }) {
    const icon = p.icon ? `<span class="visual-only phui-icon-view phui-font-fa ${p.icon}"></span>` : '';
    return `<li class="phabricator-handle-tag-list-item" title="Prefill this destination">`
      + `<span class="phui-tag-view phui-tag-type-shade phui-tag-${p.color} phui-tag-shade phui-tag-icon-view">`
      + `<span class="phui-tag-core">${icon}${p.name}</span></span> `
      + `<span class="maniphest-board-link">(${columnName})</span>`
      + ` <span class="tcm-del" title="Remove from recent">[x]</span></li>`;
  }

  // --- UI ------------------------------------------------------------------

  // Layout/labels/button reuse Phabricator's own form classes; this covers input
  // borders (not set in core CSS), the typeahead, the float panel, and selection.
  const css = `
    .tcm-body input[type=text], .tcm-body select { width:100%; box-sizing:border-box;
      padding:4px 6px; border:1px solid #c7ccd9; border-radius:3px; font-size:13px; }
    .tcm-body button.button[disabled] { opacity:.5; cursor:default; }
    .tcm-body label.aphront-form-label { height:auto; line-height:1.2; }
    .tcm-body .aphront-form-control { padding:2px 0; }
    .tcm-sugg { border:1px solid #c7ccd9; border-top:0; max-height:160px; overflow:auto; background:#fff; }
    .tcm-sugg div { padding:4px 6px; cursor:pointer; font-size:13px; }
    .tcm-sugg div:hover { background:#eaf0ff; }
    .tcm-mru .phabricator-handle-tag-list-item { cursor:pointer; }
    .tcm-del { color:#c0392b; cursor:pointer; font-size:11px; }
    .tcm-actions { display:flex; gap:6px; }
    .tcm-count { font-size:12px; color:#6b748c; margin:4px 0 2px; }
    .tcm-status { margin-top:6px; font-size:12px; color:#c0392b; }
    .tcm-status:empty { display:none; }
    .tcm-float { position:fixed; bottom:16px; right:16px; width:300px; z-index:1000;
      background:#fff; border:1px solid #c7ccd9; border-radius:4px;
      box-shadow:0 4px 16px rgba(0,0,0,.15); padding:2px 12px 12px; }
    .tcm-cb { display:none; cursor:pointer; }
    .device-desktop .phui-workcard.phui-oi:hover .tcm-cb,
    body.tcm-selecting .tcm-cb { display:block; }
    /* Phab's input[type="checkbox"] rule outranks a bare class, so match it. */
    input[type="checkbox"].tcm-cb { margin:1px 0 0 5px; }
    .phui-workcard.tcm-selected { outline:2px solid #3498db; outline-offset:-2px; }
    .phui-header-action-list .tcm-selall-li { display:none; }
    .phui-header-shell:hover .tcm-selall-li,
    body.tcm-selecting .phui-header-action-list .tcm-selall-li { display:inline-block; }
    /* No margin override: Phab's own input[type=checkbox] spacing looks right. */
    input[type="checkbox"].tcm-selall { cursor:pointer; vertical-align:middle; }
  `;

  // config: { getTargets():[monogram], removeOptions:[{name,slug,pid}], showCount:bool }
  function build(config) {
    const panel = document.createElement('div');
    panel.className = 'phui-curtain-panel';
    panel.innerHTML = `
      <div class="phui-curtain-panel-header">Move tag + column</div>
      <div class="phui-curtain-panel-body tcm-body">
        <div class="tcm-count" style="display:none"></div>
        <div class="phui-form-view phui-form-full-width">
          <div class="aphront-form-control aphront-form-control-select">
            <label class="aphront-form-label">Remove tag</label>
            <div class="aphront-form-input">
              <select class="tcm-remove"><option value="">(keep all tags)</option></select>
            </div>
          </div>
          <div class="aphront-form-control aphront-form-control-text">
            <label class="aphront-form-label">To board</label>
            <div class="aphront-form-input">
              <input type="text" class="tcm-proj" placeholder="type a project name" autocomplete="off">
              <div class="tcm-sugg" style="display:none"></div>
            </div>
          </div>
          <div class="aphront-form-control aphront-form-control-select">
            <label class="aphront-form-label">Column</label>
            <div class="aphront-form-input">
              <select class="tcm-col"><option value="">(pick a board first)</option></select>
            </div>
          </div>
          <div class="aphront-form-control tcm-mru-control" style="display:none">
            <label class="aphront-form-label">Recent</label>
            <div class="aphront-form-input"><div class="tcm-mru"></div></div>
          </div>
          <div class="aphront-form-control">
            <div class="aphront-form-input">
              <div class="tcm-actions">
                <button type="button" class="button tcm-go" disabled>Move</button>
                <button type="button" class="button button-green tcm-go-assign" disabled>Move + claim</button>
              </div>
              <div class="tcm-status"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const $ = (s) => panel.querySelector(s);
    const removeSel = $('.tcm-remove');
    const projInput = $('.tcm-proj');
    const sugg = $('.tcm-sugg');
    const colSel = $('.tcm-col');
    const mruControl = $('.tcm-mru-control');
    const mruDiv = $('.tcm-mru');
    const countEl = $('.tcm-count');
    const goBtn = $('.tcm-go');
    const status = $('.tcm-status');
    const assignBtn = $('.tcm-go-assign');

    if (config.showCount) countEl.style.display = '';

    let picked = null; // the chosen destination project, recorded into the MRU on submit
    let busy = false;  // an edit is in flight; refresh() must not re-enable submit
    // Writes are guarded: the board observer treats any DOM change as a cue to
    // re-render, so an unconditional write here would feed back into itself.
    const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
    const setStatus = (msg, ok) => { setText(status, msg || ''); status.style.color = ok ? '#27ae60' : '#c0392b'; };
    const pick = (p) => { picked = p; projInput.value = p.name; };
    const refresh = () => {
      const n = config.getTargets().length;
      if (config.showCount) setText(countEl, `${n} selected`);
      goBtn.disabled = busy || !colSel.value || !n;
      assignBtn.disabled = busy || !colSel.value || !n || !viewer;
    };

    // "Move + claim" is enabled only once we can resolve the viewer's PHID.
    let viewer = null;
    viewerPHID().then((phid) => {
      viewer = phid;
      refresh();
      if (!phid) assignBtn.title = 'Could not determine your user';
    });

    // Removal options are supplied by the caller (task tags, or the board).
    config.removeOptions.forEach((t) => {
      const o = new Option(t.name, t.slug || t.pid);
      if (t.slug) o.dataset.slug = t.slug; else o.dataset.pid = t.pid;
      removeSel.add(o);
    });

    async function loadColumns(projPHID, preselect) {
      colSel.innerHTML = '<option value="">loading...</option>';
      try {
        const cols = await columnsFor(projPHID);
        colSel.innerHTML = '<option value="">(pick a column)</option>';
        cols.forEach((c) => colSel.add(new Option(c.hidden ? `${c.name} (hidden)` : c.name, c.phid)));
        if (preselect) colSel.value = preselect;
      } catch (e) {
        setStatus(`Couldn't load columns: ${e.message}`);
      }
      refresh();
    }

    let debounce;
    projInput.addEventListener('input', () => {
      picked = null;
      colSel.innerHTML = '<option value="">(pick a board first)</option>';
      refresh();
      clearTimeout(debounce);
      const text = projInput.value.trim();
      if (text.length < 2) { sugg.style.display = 'none'; return; }
      debounce = setTimeout(async () => {
        try {
          const hits = await searchProjects(text);
          sugg.innerHTML = '';
          hits.forEach((p) => {
            const d = document.createElement('div');
            d.textContent = p.name;
            d.onclick = () => { pick(p); sugg.style.display = 'none'; loadColumns(p.phid); };
            sugg.appendChild(d);
          });
          sugg.style.display = hits.length ? 'block' : 'none';
        } catch (e) { setStatus(e.message); }
      }, 250);
    });

    colSel.addEventListener('change', refresh);

    document.addEventListener('click', (ev) => {
      if (ev.target !== projInput && !sugg.contains(ev.target)) sugg.style.display = 'none';
    });

    function renderMru() {
      const mru = loadMru();
      mruControl.style.display = mru.length ? '' : 'none';
      mruDiv.innerHTML = mru.length ? `<ul class="phabricator-handle-tag-list">${mru.map(tagItem).join('')}</ul>` : '';
      [...mruDiv.querySelectorAll('.phabricator-handle-tag-list-item')].forEach((el, i) => {
        el.onclick = () => { pick(mru[i].project); loadColumns(mru[i].project.phid, mru[i].columnPHID); };
        el.querySelector('.tcm-del').onclick = (ev) => { ev.stopPropagation(); removeMru(mru[i].columnPHID); renderMru(); };
      });
    }
    renderMru();

    async function doMove(assign) {
      const targets = config.getTargets();
      if (busy || !colSel.value || !targets.length) return;
      busy = true;
      refresh();
      let done = 0;
      try {
        const opt = removeSel.selectedOptions[0];
        const removePHID = opt && opt.value ? await resolvePHID(opt.dataset.slug, opt.dataset.pid) : null;
        const ownerPHID = assign ? viewer : null;
        for (const t of targets) {
          setStatus(`Applying ${++done}/${targets.length}...`);
          await applyMove(t, { removePHID, ownerPHID, columnPHID: colSel.value });
        }
        pushMru({ project: picked, columnPHID: colSel.value, columnName: colSel.selectedOptions[0].text });
        setStatus(`Moved ${targets.length}.`, true);
        busy = false;
        config.onDone(targets.length);
      } catch (e) {
        setStatus(`${e.message} (stopped after ${done}/${targets.length})`);
        busy = false;
        refresh();
      }
    }
    goBtn.addEventListener('click', () => doMove(false));
    assignBtn.addEventListener('click', () => doMove(true));

    return { el: panel, refresh, note: setStatus, isBusy: () => busy };
  }

  // --- Task mode: curtain panel below Project Tags -------------------------

  function initTaskMode(monogram) {
    const { el } = build({
      getTargets: () => [monogram],
      removeOptions: readTagsFromDom(),
      showCount: false,
      onDone: () => location.reload(),
    });

    const tagsPanel = [...document.querySelectorAll('.phui-curtain-panel')].find(
      (p) => p.querySelector('.phui-curtain-panel-header')?.textContent.trim() === 'Project Tags'
    );
    if (tagsPanel) { tagsPanel.after(el); return; }

    const rail = document.querySelector('.phui-side-column');
    if (rail) { console.warn('[tag+column move] Project Tags panel not found; appended to rail.'); rail.appendChild(el); return; }

    console.warn('[tag+column move] Side rail not found; using fixed panel.');
    el.classList.add('tcm-float');
    document.body.appendChild(el);
  }

  // --- Board mode: select cards, then act on the set -----------------------

  function boardRemoveOption() {
    let m;
    if ((m = location.pathname.match(/\/project\/board\/(\d+)/))) return [{ name: 'this board', pid: m[1] }];
    if ((m = location.pathname.match(/^\/tag\/([^/]+)\//))) return [{ name: 'this board', slug: m[1] }];
    return [];
  }

  function initBoardMode() {
    const selected = new Set();   // monograms; the only source of truth
    let api = null;
    let floatWrap = null;
    let linger = false;           // keep the panel up briefly after a move

    const cardsIn = (root) => [...root.querySelectorAll('.phui-workcard')];
    const monoOf = (card) => {
      const name = card.querySelector('.phui-oi-objname');
      if (name) return name.textContent.trim();
      const href = card.querySelector('a.phui-oi-link')?.getAttribute('href') || '';
      return (href.match(/\/(T\d+)/) || [])[1] || null;
    };
    const monosIn = (root) => cardsIn(root).map(monoOf).filter(Boolean);

    function ensurePanel() {
      if (api) return;
      api = build({ getTargets: () => [...selected], removeOptions: boardRemoveOption(), showCount: true, onDone });
      floatWrap = Object.assign(document.createElement('div'), { className: 'tcm-float' });
      floatWrap.appendChild(api.el);
      document.body.appendChild(floatWrap);
    }

    // Everything visible is drawn from `selected`: card checkboxes, outlines,
    // the header tri-states, and the panel. Cards rebuilt by Phabricator are
    // therefore restored automatically on the next pass.
    function render() {
      const active = selected.size > 0;
      cardsIn(document).forEach((card) => {
        const mono = monoOf(card);
        const on = !!mono && selected.has(mono);
        const cb = card.querySelector('.tcm-cb');
        if (cb) cb.checked = on;
        card.classList.toggle('tcm-selected', on);
      });
      document.querySelectorAll('.phui-workpanel-view').forEach((panel) => {
        const box = panel.querySelector('.tcm-selall');
        if (!box) return;
        const monos = monosIn(panel);
        const n = monos.filter((m) => selected.has(m)).length;
        box.checked = monos.length > 0 && n === monos.length;
        box.indeterminate = n > 0 && n < monos.length;
      });
      document.body.classList.toggle('tcm-selecting', active);
      if (active) ensurePanel();
      if (api) {
        floatWrap.style.display = active || linger ? '' : 'none';
        api.refresh();
      }
    }

    // Cards update themselves via the board's live refresh, so a move only
    // clears local selection; the panel lingers so the result stays readable.
    let doneTimer = null;
    function onDone() {
      selected.clear();
      missingSince.clear();
      linger = true;
      render();
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => { linger = false; api.note(''); render(); }, 5000);
    }

    function injectCard(card) {
      if (card.querySelector('.tcm-cb')) return;
      // Share the edit pencil's li: sits just below it, same hover-reveal.
      const host = card.querySelector('li[data-sigil="edit-project-card"]') || card.querySelector('.phui-oi-actions');
      if (!host) return;
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'tcm-cb' });
      host.appendChild(cb);
      cb.addEventListener('change', () => {
        const mono = monoOf(card);
        if (!mono) return;
        if (cb.checked) selected.add(mono); else selected.delete(mono);
        render();
      });
    }

    function injectHeader(panel) {
      const list = panel.querySelector('.phui-header-action-list');
      if (!list || list.querySelector('.tcm-selall')) return;
      const li = Object.assign(document.createElement('li'), { className: 'phui-header-action-item tcm-selall-li' });
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'tcm-selall', title: 'Select all in column' });
      cb.setAttribute('aria-label', 'Select all in column');
      li.appendChild(cb);
      list.appendChild(li);
      // Intent comes from the cards, not this box's toggled value; render()
      // then sets its checked/indeterminate state correctly.
      cb.addEventListener('change', () => {
        const monos = monosIn(panel);
        const want = !monos.every((m) => selected.has(m));
        monos.forEach((m) => (want ? selected.add(m) : selected.delete(m)));
        render();
      });
    }

    const inject = (root) => {
      if (root.matches?.('.phui-workcard')) injectCard(root);
      if (root.matches?.('.phui-workpanel-view')) injectHeader(root);
      root.querySelectorAll('.phui-workcard').forEach(injectCard);
      root.querySelectorAll('.phui-workpanel-view').forEach(injectHeader);
    };
    inject(document);

    // A card vanishes briefly whenever Phabricator re-renders it, so absence is
    // only meaningful if it persists: past the grace period the task really has
    // left this board (someone else moved it).
    const GRACE_MS = 2500;
    const missingSince = new Map();
    let graceTimer = null;

    function pruneMissing() {
      // Our own in-flight moves remove cards; that is not someone else's edit.
      if (api && api.isBusy()) return;
      const present = new Set(monosIn(document));
      const now = Date.now();
      const dropped = [];
      for (const mono of selected) {
        if (present.has(mono)) { missingSince.delete(mono); continue; }
        const since = missingSince.get(mono);
        if (since === undefined) missingSince.set(mono, now);
        else if (now - since >= GRACE_MS) { selected.delete(mono); missingSince.delete(mono); dropped.push(mono); }
      }
      clearTimeout(graceTimer);
      if (missingSince.size) graceTimer = setTimeout(() => { pruneMissing(); render(); }, GRACE_MS);
      if (dropped.length && api) api.note(`${dropped.join(', ')} left this board; deselected.`);
    }

    // Re-render churn fires many mutations; coalesce the follow-up pass.
    let pending = false;
    function resync() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; pruneMissing(); render(); });
    }

    new MutationObserver((muts) => {
      let touched = false;
      for (const m of muts) {
        // The panel lives in <body> too; reacting to its own writes would loop.
        if (floatWrap && floatWrap.contains(m.target)) continue;
        touched = true;
        for (const n of m.addedNodes) if (n.nodeType === 1) inject(n);
      }
      if (touched) resync();
    }).observe(document.body, { childList: true, subtree: true });

    // Keep checkbox interaction from reaching Javelin (no drag start, no edit
    // action); the checkbox's own toggle still fires. Capture beats bubbling.
    ['mousedown', 'click'].forEach((type) =>
      document.addEventListener(type, (ev) => {
        if (ev.target.closest('.tcm-cb, .tcm-selall-li')) ev.stopPropagation();
      }, true));
  }

  // --- Dispatch ------------------------------------------------------------

  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

  const monogram = (location.pathname.match(/\/(T\d+)/) || [])[1];
  if (monogram) initTaskMode(monogram);
  else if (document.querySelector('.phui-workcard')) initBoardMode();
})();