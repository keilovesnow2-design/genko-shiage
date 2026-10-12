// 原稿仕上げ（仮）— 画面まわり。置換そのものは engine.js が担当する。
(function () {
  'use strict';

  const STATE_KEY = 'genko.v1.state';
  const DRAFT_KEY = 'genko.v1.draft';
  const PHRASE_MIN_LEN = 8; // これ以上の長さの置き換え対象は「一節・一文」として扱う
  const FORMS = [
    { id: 'keep', label: 'そのまま' },
    { id: 'arabic', label: '算用数字' },
    { id: 'kanji', label: '漢数字' },
  ];
  const SAMPLE = [
    '二十日間、毎日続けた人の話です。',
    '十個のうち、三つだけが残りました。',
    '二十日に会う約束は、そのままにします。',
  ].join('\n');

  const $ = (id) => document.getElementById(id);
  const el = {
    input: $('input'), output: $('output'), inCount: $('in-count'), outMeta: $('out-meta'),
    copyMsg: $('copy-msg'), rulesBadge: $('rules-badge'),
    ruleSearch: $('rule-search'), ruleFilter: $('rule-filter'),
    ruleList: $('rule-list'), ruleEmpty: $('rule-empty'),
    counterList: $('counter-list'), counterForm: $('counter-form'), newCounter: $('new-counter'),
    dataMsg: $('data-msg'),
    suggest: $('suggest'), suggestList: $('suggest-list'),
    bulkText: $('bulk-text'), bulkMsg: $('bulk-msg'),
  };

  const COPY_HINT = document.getElementById('copy-msg').textContent;

  // ── 状態 ──────────────────────────────────────────────────────────
  function defaultState() {
    return { rules: [], counters: GenkoEngine.DEFAULT_COUNTERS.map((c) => Object.assign({}, c)) };
  }
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (s && Array.isArray(s.rules) && Array.isArray(s.counters)) return s;
    } catch (_) { /* 保存領域が使えない環境でも動かす */ }
    return defaultState();
  }
  let state = loadState();
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
  }
  function newId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function kindOf(rule) { return rule.from.length >= PHRASE_MIN_LEN ? 'phrase' : 'word'; }

  // ── 仕上がりの描画 ────────────────────────────────────────────────
  let lastChanges = [];
  function refreshOutput() {
    const src = el.input.value;
    const res = GenkoEngine.apply(src, state);
    lastChanges = res.changes;
    el.inCount.textContent = src.length + '文字';
    el.outMeta.textContent = '置き換え ' + res.changes.length + ' か所';

    const frag = document.createDocumentFragment();
    let pos = 0;
    res.changes.forEach((c, i) => {
      if (c.start > pos) frag.appendChild(document.createTextNode(res.text.slice(pos, c.start)));
      const m = document.createElement('mark');
      m.textContent = res.text.slice(c.start, c.end);
      m.dataset.idx = String(i);
      m.title = '置き換え前：' + c.from + '（押すと、このルールを開きます）';
      if (c.type === 'counter') m.className = 'num';
      frag.appendChild(m);
      pos = c.end;
    });
    if (pos < res.text.length) frag.appendChild(document.createTextNode(res.text.slice(pos)));
    el.output.replaceChildren(frag);
    el.output.dataset.text = res.text;
    renderSuggest(src);
  }

  // ── 要注意語（原稿に出てきた、読みが分かれやすい語） ──────────────────
  function renderSuggest(src) {
    const hits = GenkoEngine.findWatch(src, window.GenkoWatchWords || [], state.rules);
    el.suggest.hidden = hits.length === 0;
    el.suggestList.replaceChildren(...hits.map((h) => {
      const li = document.createElement('li');
      li.className = 'sg' + (h.registeredTo !== null ? ' done' : '');
      const top = document.createElement('div');
      top.className = 'sg-top';
      const w = document.createElement('span');
      w.className = 'sg-word'; w.textContent = h.word;
      const n = document.createElement('span');
      n.className = 'sg-count';
      n.textContent = h.count + '回' + (h.registeredTo !== null ? '　登録済み → ' + h.registeredTo : '');
      top.append(w, n);
      const chips = document.createElement('div');
      chips.className = 'sg-chips';
      h.readings.forEach((r) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (h.registeredTo === r ? ' on' : '');
        b.textContent = r;
        b.title = '「' + h.word + '」→「' + r + '」を登録';
        b.addEventListener('click', () => upsertRule(h.word, r));
        chips.appendChild(b);
      });
      li.append(top, chips);
      if (h.hint) {
        const p = document.createElement('div');
        p.className = 'sg-hint'; p.textContent = h.hint;
        li.appendChild(p);
      }
      return li;
    }));
  }

  // 同じ変換元があれば上書き、なければ追加。追加・更新があれば true
  function upsertRule(from, to) {
    const exist = state.rules.find((r) => r.from === from);
    if (exist) {
      if (exist.to === to && exist.enabled !== false) return false;
      exist.to = to; exist.enabled = true;
    } else {
      state.rules.unshift({ id: newId(), from, to, loose: false, enabled: true });
    }
    commit(true);
    return true;
  }

  // ── ルール一覧 ────────────────────────────────────────────────────
  function renderRules() {
    const q = el.ruleSearch.value.trim();
    const f = el.ruleFilter.value;
    const items = state.rules.filter((r) => {
      if (q && !(r.from.includes(q) || String(r.to).includes(q))) return false;
      if (f === 'word') return kindOf(r) === 'word';
      if (f === 'phrase') return kindOf(r) === 'phrase';
      if (f === 'off') return r.enabled === false;
      return true;
    });
    el.rulesBadge.textContent = state.rules.filter((r) => r.from.trim() !== '').length + '件';
    el.ruleEmpty.style.display = items.length ? 'none' : '';
    el.ruleEmpty.textContent = state.rules.length
      ? '該当するルールがありません。'
      : 'まだルールがありません。「＋ ルールを追加」を押して、「原文」と「修正後」を書いてください。';

    el.ruleList.replaceChildren(...items.map(ruleRow));
  }

  function ruleRow(rule) {
    const li = document.createElement('li');
    li.className = 'rule' + (rule.enabled === false ? ' off' : '');
    li.dataset.id = rule.id;

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = kindOf(rule) === 'phrase' ? '一節' : '言葉';

    const from = textInput(rule.from, '原文', '置き換えたい言葉・文章', (v) => { rule.from = v; kind.textContent = kindOf(rule) === 'phrase' ? '一節' : '言葉'; });
    const arrow = document.createElement('span');
    arrow.className = 'arrow'; arrow.textContent = '→';
    const to = textInput(rule.to, '修正後', '置き換えた後', (v) => { rule.to = v; });

    const loose = checkbox('ゆるく一致', rule.loose === true, (v) => { rule.loose = v; });
    loose.title = '空白や句読点の違いを無視して照合します（一節向け）';
    const on = checkbox('使う', rule.enabled !== false, (v) => {
      rule.enabled = v; li.classList.toggle('off', !v);
    });

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'icon-btn'; del.textContent = '削除';
    del.addEventListener('click', () => {
      state.rules = state.rules.filter((r) => r.id !== rule.id);
      commit(true);
    });

    li.append(kind, from, arrow, to, loose, on, del);
    return li;
  }

  function textInput(value, label, placeholder, onChange) {
    const i = document.createElement('input');
    i.type = 'text'; i.value = value == null ? '' : String(value);
    i.setAttribute('aria-label', label); i.placeholder = placeholder;
    i.addEventListener('input', () => { onChange(i.value); commit(false); });
    return i;
  }
  function checkbox(label, checked, onChange) {
    const l = document.createElement('label');
    l.className = 'chk';
    const c = document.createElement('input');
    c.type = 'checkbox'; c.checked = checked;
    c.addEventListener('change', () => { onChange(c.checked); commit(false); });
    l.append(c, document.createTextNode(label));
    return l;
  }

  // ── 数字の形 ──────────────────────────────────────────────────────
  function renderCounters() {
    el.counterList.replaceChildren(...state.counters.map((c) => {
      const li = document.createElement('li');
      li.className = 'counter';
      li.dataset.counter = c.counter;
      const name = document.createElement('span');
      name.className = 'name'; name.textContent = c.counter;
      const seg = document.createElement('span');
      seg.className = 'seg';
      FORMS.forEach((f) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = f.label;
        b.className = c.form === f.id ? 'on' : '';
        b.setAttribute('aria-pressed', c.form === f.id ? 'true' : 'false');
        b.addEventListener('click', () => { c.form = f.id; commit(true); });
        seg.appendChild(b);
      });
      li.append(name, seg);
      return li;
    }));
  }

  // ── 共通 ──────────────────────────────────────────────────────────
  function commit(rerenderLists) {
    saveState();
    el.rulesBadge.textContent = state.rules.filter((r) => r.from.trim() !== '').length + '件';
    refreshOutput();
    if (rerenderLists) { renderRules(); renderCounters(); }
  }

  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + name));
  }

  function flash(node) {
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 1600);
  }

  // ── イベント ──────────────────────────────────────────────────────
  el.input.addEventListener('input', () => {
    refreshOutput();
    try { localStorage.setItem(DRAFT_KEY, el.input.value); } catch (_) {}
  });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  el.output.addEventListener('click', (e) => {
    const m = e.target.closest('mark');
    if (!m) return;
    const c = lastChanges[Number(m.dataset.idx)];
    if (!c) return;
    if (c.type === 'rule') {
      showTab('rules');
      el.ruleSearch.value = ''; el.ruleFilter.value = 'all';
      renderRules();
      flash(el.ruleList.querySelector('[data-id="' + c.ruleId + '"]'));
    } else {
      showTab('counters');
      flash(el.counterList.querySelector('[data-counter="' + CSS.escape(c.counter) + '"]'));
    }
  });

  $('btn-bulk').addEventListener('click', () => {
    const { pairs, skipped } = GenkoEngine.parsePairs(el.bulkText.value);
    if (pairs.length === 0) {
      el.bulkMsg.textContent = '追加できる行がありません。「原文 → 修正後」の形で書いてください。';
      return;
    }
    let added = 0, updated = 0;
    pairs.forEach((p) => {
      const exist = state.rules.find((r) => r.from === p.from);
      if (exist) { exist.to = p.to; exist.enabled = true; updated++; }
      else { state.rules.unshift({ id: newId(), from: p.from, to: p.to, loose: false, enabled: true }); added++; }
    });
    el.bulkText.value = '';
    commit(true);
    el.bulkMsg.textContent = '追加 ' + added + ' 件、上書き ' + updated + ' 件'
      + (skipped ? '（区切りのない ' + skipped + ' 行は読み飛ばしました）' : '') + '。';
  });

  $('btn-add-selection').addEventListener('click', () => {
    const { selectionStart: s, selectionEnd: e } = el.input;
    const sel = el.input.value.slice(s, e);
    showTab('rules');
    if (!sel.trim()) {
      el.copyMsg.textContent = '先に原稿内の文字を選んでください。';
      setTimeout(() => { el.copyMsg.textContent = COPY_HINT; }, 2500);
      return;
    }
    // 同じ言葉が登録済みならその行を、空の行があればそこを使い、なければ新しい行を足す
    let rule = state.rules.find((r) => r.from === sel)
      || state.rules.find((r) => r.from === '' && r.to === '');
    if (rule) rule.from = sel;
    else { rule = { id: newId(), from: sel, to: '', loose: false, enabled: true }; state.rules.unshift(rule); }
    el.ruleSearch.value = ''; el.ruleFilter.value = 'all';
    commit(true);
    const row = el.ruleList.querySelector('[data-id="' + rule.id + '"]');
    const toInput = row && row.querySelectorAll('input[type="text"]')[1];
    if (toInput) toInput.focus();
    flash(row);
  });

  // 前のツールと同じ「＋ ルールを追加」: 空の行を足して、そのまま書き込む
  $('btn-add-row').addEventListener('click', () => {
    const blank = state.rules.find((r) => r.from === '' && r.to === '');
    const id = blank ? blank.id : newId();
    if (!blank) state.rules.unshift({ id, from: '', to: '', loose: false, enabled: true });
    el.ruleSearch.value = ''; el.ruleFilter.value = 'all';
    commit(true);
    const first = el.ruleList.querySelector('[data-id="' + id + '"] input[type="text"]');
    if (first) first.focus();
  });

  $('btn-clear-rules').addEventListener('click', () => {
    if (state.rules.length === 0) return;
    if (!confirm('ルールを ' + state.rules.length + ' 件すべて削除しますか？（元に戻せません）')) return;
    state.rules = [];
    commit(true);
  });

  el.ruleSearch.addEventListener('input', renderRules);
  el.ruleFilter.addEventListener('change', renderRules);

  el.counterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.newCounter.value.trim();
    if (!name) return;
    if (!state.counters.some((c) => c.counter === name)) state.counters.unshift({ counter: name, form: 'arabic' });
    el.newCounter.value = '';
    commit(true);
  });

  $('btn-copy').addEventListener('click', async () => {
    const text = el.output.dataset.text || '';
    try {
      await navigator.clipboard.writeText(text);
      el.copyMsg.textContent = 'コピーしました。';
    } catch (_) {
      const r = document.createRange();
      r.selectNodeContents(el.output);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      el.copyMsg.textContent = '選択しました。Ctrl+C でコピーしてください。';
    }
    setTimeout(() => { el.copyMsg.textContent = COPY_HINT; }, 2500);
  });

  $('btn-sample').addEventListener('click', () => { el.input.value = SAMPLE; el.input.dispatchEvent(new Event('input')); });
  $('btn-clear').addEventListener('click', () => { el.input.value = ''; el.input.dispatchEvent(new Event('input')); el.input.focus(); });

  // ── 保存・読み込み ────────────────────────────────────────────────
  function say(msg) { el.dataMsg.textContent = msg; }

  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'genko-shiage', version: 1, rules: state.rules, counters: state.counters }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'genko-shiage-rules.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say('書き出しました。');
  });

  $('file-import').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : Array.isArray(data.rules) ? data.rules : null;
      if (!incoming) throw new Error('rules がありません');
      let added = 0, updated = 0;
      incoming.forEach((r) => {
        if (!r || typeof r.from !== 'string' || !r.from.trim()) return;
        const to = r.to == null ? '' : String(r.to);
        const exist = state.rules.find((x) => x.from === r.from);
        if (exist) { exist.to = to; updated++; }
        else { state.rules.push({ id: newId(), from: r.from, to, loose: r.loose === true, enabled: r.enabled !== false }); added++; }
      });
      if (!Array.isArray(data) && Array.isArray(data.counters)) {
        state.counters = data.counters
          .filter((c) => c && typeof c.counter === 'string' && FORMS.some((f) => f.id === c.form))
          .map((c) => ({ counter: c.counter, form: c.form }));
      }
      commit(true);
      say('読み込みました（追加 ' + added + ' 件、上書き ' + updated + ' 件）。');
    } catch (err) {
      say('読み込めませんでした：' + err.message);
    }
  });

  $('btn-reset').addEventListener('click', () => {
    if (!confirm('ルールと数字の設定をすべて初期状態に戻します。よろしいですか？')) return;
    state = defaultState();
    commit(true);
    say('初期化しました。');
  });

  // ── 明るさの切り替え（ライト／ダーク） ───────────────────────────
  // 初期値はパソコン・ブラウザの設定に従う。ボタンで切り替えると、その選択を覚える。
  const THEME_KEY = 'genko.v1.theme';
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function effectiveTheme() {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark' || t === 'light') return t;
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }
  function renderThemeButton() {
    $('btn-theme').textContent = effectiveTheme() === 'dark' ? '☀ ライトにする' : '🌙 ダークにする';
  }
  $('btn-theme').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
    renderThemeButton();
  });
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', renderThemeButton);
  renderThemeButton();

  // ── 起動 ──────────────────────────────────────────────────────────
  try { el.input.value = localStorage.getItem(DRAFT_KEY) || ''; } catch (_) {}
  renderRules();
  renderCounters();
  refreshOutput();
})();
