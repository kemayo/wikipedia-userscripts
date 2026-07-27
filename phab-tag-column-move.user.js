// ==UserScript==
// @name         Phabricator: move tag + column in one step
// @version      2026-07-22
// @description  Quick move to a specific tag-with-column
// @author       David Lynch
// @namespace    davidlynch.org
// @match        https://phabricator.wikimedia.org/T*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// Adds a curtain panel below "Project Tags" that applies a single maniphest.edit:
// optionally remove one current tag, and move the task into an arbitrary column
// of any project. The `column` transaction auto-attaches the destination board,
// so "leave sprint A, enter column Z of sprint B" is one atomic edit.
//
// Auth: session cookies + CSRF header, no stored API token. If Conduit rejects
// the write with an auth (not CSRF) error, add `api.token` to conduit()'s body
// and switch `credentials` to 'omit'.

(function () {
  'use strict';

  const MRU_KEY = 'phab-tagmove-mru';
  const MRU_MAX = 6;

  const monogram = (location.pathname.match(/\/(T\d+)/) || [])[1];
  if (!monogram) return;

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

  async function applyMove(removePHID, columnPHID) {
    const txns = [];
    if (removePHID) txns.push({ type: 'projects.remove', value: [removePHID] });
    txns.push({ type: 'column', value: columnPHID }); // auto-adds the board
    return conduit('maniphest.edit', { objectIdentifier: monogram, transactions: txns });
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

  // Native list-item markup so rows match the Project Tags section exactly.
  function tagItem({ project: p, columnName }) {
    const icon = p.icon ? `<span class="visual-only phui-icon-view phui-font-fa ${p.icon}"></span>` : '';
    return `<li class="phabricator-handle-tag-list-item" title="Prefill this destination">`
      + `<span class="phui-tag-view phui-tag-type-shade phui-tag-${p.color} phui-tag-shade phui-tag-icon-view">`
      + `<span class="phui-tag-core">${icon}${p.name}</span></span> `
      + `<span class="maniphest-board-link">(${columnName})</span></li>`;
  }

  // --- UI ------------------------------------------------------------------

  const css = `
    .tcm-body label { display:block; margin:8px 0 2px; font-size:11px;
      text-transform:uppercase; letter-spacing:.5px; color:#6b748c; }
    .tcm-body select, .tcm-body input[type=text] { width:100%; box-sizing:border-box;
      padding:4px 6px; border:1px solid #c7ccd9; border-radius:3px; font-size:13px; }
    .tcm-sugg { border:1px solid #c7ccd9; border-top:0; border-radius:0 0 3px 3px;
      max-height:160px; overflow:auto; background:#fff; }
    .tcm-sugg div { padding:4px 6px; cursor:pointer; font-size:13px; }
    .tcm-sugg div:hover { background:#eaf0ff; }
    .tcm-mru { margin-top:8px; }
    .tcm-mru .phabricator-handle-tag-list-item { cursor:pointer; }
    .tcm-go { margin-top:10px; width:100%; padding:5px; border:1px solid #3498db;
      border-radius:3px; background:#3498db; color:#fff; cursor:pointer; font-size:13px; }
    .tcm-go[disabled] { opacity:.5; cursor:default; }
    .tcm-status { margin-top:6px; font-size:12px; color:#c0392b; min-height:14px; }
  `;

  function build() {
    const panel = document.createElement('div');
    panel.className = 'phui-curtain-panel';
    panel.innerHTML = `
      <div class="phui-curtain-panel-header">Move tag + column</div>
      <div class="phui-curtain-panel-body tcm-body">
        <label>Remove tag</label>
        <select class="tcm-remove"><option value="">(keep all tags)</option></select>
        <label>To board</label>
        <input type="text" class="tcm-proj" placeholder="type a project name" autocomplete="off">
        <div class="tcm-sugg" style="display:none"></div>
        <label>Column</label>
        <select class="tcm-col"><option value="">(pick a board first)</option></select>
        <label class="tcm-mru-label" style="display:none">Recent</label>
        <div class="tcm-mru"></div>
        <button class="tcm-go" disabled>Move</button>
        <div class="tcm-status"></div>
      </div>
    `;

    const $ = (s) => panel.querySelector(s);
    const removeSel = $('.tcm-remove');
    const projInput = $('.tcm-proj');
    const sugg = $('.tcm-sugg');
    const colSel = $('.tcm-col');
    const mruLabel = $('.tcm-mru-label');
    const mruDiv = $('.tcm-mru');
    const goBtn = $('.tcm-go');
    const status = $('.tcm-status');

    let picked = null; // the chosen destination project, recorded into the MRU on submit
    const setStatus = (msg, ok) => { status.textContent = msg || ''; status.style.color = ok ? '#27ae60' : '#c0392b'; };
    const refreshGo = () => { goBtn.disabled = !colSel.value; };
    const pick = (p) => { picked = p; projInput.value = p.name; };

    // Removal options straight from the DOM; no API call needed at load.
    readTagsFromDom().forEach((t) => {
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
      refreshGo();
    }

    let debounce;
    projInput.addEventListener('input', () => {
      picked = null;
      colSel.innerHTML = '<option value="">(pick a board first)</option>';
      refreshGo();
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

    colSel.addEventListener('change', refreshGo);

    (function renderMru() {
      const mru = loadMru();
      mruLabel.style.display = mru.length ? 'block' : 'none';
      mruDiv.innerHTML = mru.length ? `<ul class="phabricator-handle-tag-list">${mru.map(tagItem).join('')}</ul>` : '';
      [...mruDiv.querySelectorAll('.phabricator-handle-tag-list-item')].forEach((el, i) => {
        el.onclick = () => { pick(mru[i].project); loadColumns(mru[i].project.phid, mru[i].columnPHID); };
      });
    })();

    goBtn.addEventListener('click', async () => {
      if (!colSel.value) return;
      goBtn.disabled = true;
      setStatus('Applying...');
      try {
        const opt = removeSel.selectedOptions[0];
        const removePHID = opt && opt.value ? await resolvePHID(opt.dataset.slug, opt.dataset.pid) : null;
        await applyMove(removePHID, colSel.value);
        pushMru({ project: picked, columnPHID: colSel.value, columnName: colSel.selectedOptions[0].text });
        setStatus('Done, reloading...', true);
        location.reload();
      } catch (e) {
        setStatus(e.message);
        goBtn.disabled = false;
      }
    });

    return panel;
  }

  // Placement: a new curtain panel right after the "Project Tags" panel, in the
  // side rail. This is the only markup-coupled part; the move logic depends only
  // on the stable Conduit API.
  function mount() {
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
    const box = build();

    const tagsPanel = [...document.querySelectorAll('.phui-curtain-panel')].find(
      (p) => p.querySelector('.phui-curtain-panel-header')?.textContent.trim() === 'Project Tags'
    );
    if (tagsPanel) { tagsPanel.after(box); return; }

    const rail = document.querySelector('.phui-side-column');
    if (rail) { console.warn('[tag+column move] Project Tags panel not found; appended to rail.'); rail.appendChild(box); return; }

    console.warn('[tag+column move] Side rail not found; using fixed panel.');
    box.style.cssText = 'position:fixed;right:10px;bottom:10px;width:300px;z-index:9999;background:#fff;border:1px solid #dfe1e9';
    document.body.appendChild(box);
  }

  mount();
})();