// 原稿仕上げ — 置換エンジン
// ブラウザ（window.GenkoEngine）と Node（require）の両方で動く。
// 方針: 何も登録しなければ入力をそのまま返す。置換は1回通しで行い、置換後の文字は再置換しない。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GenkoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── 数字ユーティリティ ───────────────────────────────────────────────
  const DIGITS = '〇一二三四五六七八九';
  const KANJI_VAL = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const KANJI_UNIT = { '十': 10, '百': 100, '千': 1000 };

  function fullToHalf(s) {
    return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/，/g, ',');
  }

  // 漢数字 → 整数（失敗時 null）。「二十」「三百五」「一万二千」「二〇二五」に対応
  function kanjiToInt(s) {
    if (!s) return null;
    if (/^[〇一二三四五六七八九]+$/.test(s)) {
      return s.length === 1 ? KANJI_VAL[s] : parseInt(Array.from(s, (c) => KANJI_VAL[c]).join(''), 10);
    }
    let total = 0, section = 0, num = null;
    for (const ch of s) {
      if (ch in KANJI_VAL) {
        num = KANJI_VAL[ch];
      } else if (ch in KANJI_UNIT) {
        section += (num === null ? 1 : num) * KANJI_UNIT[ch];
        num = null;
      } else if (ch === '万') {
        total += ((section + (num || 0)) || 1) * 10000;
        section = 0; num = null;
      } else {
        return null;
      }
    }
    return total + section + (num || 0);
  }

  function under10000(n) {
    const th = Math.floor(n / 1000), h = Math.floor(n / 100) % 10, t = Math.floor(n / 10) % 10, o = n % 10;
    let s = '';
    if (th) s += (th === 1 ? '' : DIGITS[th]) + '千';
    if (h) s += (h === 1 ? '' : DIGITS[h]) + '百';
    if (t) s += (t === 1 ? '' : DIGITS[t]) + '十';
    if (o) s += DIGITS[o];
    return s;
  }

  // 整数 → 漢数字（1億以上は null）
  function intToKanji(n) {
    if (!Number.isInteger(n) || n < 0 || n >= 100000000) return null;
    if (n === 0) return '〇';
    const man = Math.floor(n / 10000), rest = n % 10000;
    return (man ? under10000(man) + '万' : '') + (rest ? under10000(rest) : '');
  }

  // 数字トークンを目的の形式へ。変えられない場合は元のまま返す
  function convertNumber(token, form) {
    const half = fullToHalf(token);
    const isArabic = /^\d[\d,]*$/.test(half);
    if (form === 'arabic') {
      if (isArabic) return half;
      const n = kanjiToInt(token);
      return n === null ? token : String(n);
    }
    if (form === 'kanji') {
      if (!isArabic) return token;
      const n = parseInt(half.replace(/,/g, ''), 10);
      const k = intToKanji(n);
      return k === null ? token : k;
    }
    return token;
  }

  // ── 正規表現の組み立て ───────────────────────────────────────────────
  function escRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
  }

  // 「ゆるく一致」: 空白・句読点の違いを無視して照合する
  const LOOSE_GAP = '[\\s\\u3000、。，,．.]*';
  function ruleSource(rule) {
    if (!rule.loose) return escRe(rule.from);
    const chars = Array.from(rule.from.replace(/[\s　、。，,．.]/g, ''));
    if (chars.length === 0) return escRe(rule.from);
    return chars.map(escRe).join(LOOSE_GAP);
  }

  const NUM_SRC = '(?:\\d+(?:,\\d{3})*|[０-９]+|[〇一二三四五六七八九十百千万]+)';
  // 「数十個」「何百個」「1.5個」「1,000個の途中」を誤って拾わないための否定後読み
  const NUM_GUARD = '(?<![数何幾\\d０-９.,，])';

  function buildRuleRegex(rules) {
    const usable = rules
      // 「置き換えた後」が空のルールは、書きかけとみなして使わない（選んだだけで言葉が消えるのを防ぐ）
      .filter((r) => r && r.enabled !== false && typeof r.from === 'string' && r.from.trim() !== ''
        && r.to != null && String(r.to) !== '')
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.from.length - a.r.from.length || a.i - b.i);
    if (usable.length === 0) return null;
    // 同じ変換元が重複していたら先に登録された方だけ有効
    const seen = new Set();
    const list = [];
    for (const { r } of usable) {
      const key = r.from;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(r);
    }
    const re = new RegExp('(' + list.map((r) => '(' + ruleSource(r) + ')').join('|') + ')', 'g');
    return { re, list };
  }

  function buildCounterRegex(counters) {
    const active = (counters || [])
      .filter((c) => c && c.counter && c.form && c.form !== 'keep')
      .sort((a, b) => b.counter.length - a.counter.length);
    if (active.length === 0) return null;
    const re = new RegExp(NUM_GUARD + '(' + NUM_SRC + ')(' + active.map((c) => escRe(c.counter)).join('|') + ')', 'g');
    const formOf = new Map(active.map((c) => [c.counter, c.form]));
    return { re, formOf };
  }

  // ── 本体 ────────────────────────────────────────────────────────────
  // state: { rules: [{id, from, to, loose, enabled}], counters: [{counter, form}] }
  // 返り値: { text, changes: [{ start, end, from, to, type, ruleId? }] }（start/end は出力側の位置）
  function apply(input, state) {
    const text = typeof input === 'string' ? input : '';
    const rules = (state && state.rules) || [];
    const counters = (state && state.counters) || [];
    const rb = buildRuleRegex(rules);
    const cb = buildCounterRegex(counters);
    if (!rb && !cb) return { text, changes: [] };

    let out = '';
    const changes = [];
    let pos = 0;

    function nextMatch(re, from) {
      if (!re) return null;
      re.lastIndex = from;
      return re.exec(text);
    }

    while (pos <= text.length) {
      const rm = nextMatch(rb && rb.re, pos);
      const cm = nextMatch(cb && cb.re, pos);
      let pick = null;
      if (rm && cm) pick = rm.index <= cm.index ? { t: 'rule', m: rm } : { t: 'counter', m: cm };
      else if (rm) pick = { t: 'rule', m: rm };
      else if (cm) pick = { t: 'counter', m: cm };
      if (!pick) break;

      const { t, m } = pick;
      if (m[0].length === 0) { // 念のため無限ループ防止
        out += text.slice(pos, m.index + 1);
        pos = m.index + 1;
        continue;
      }
      out += text.slice(pos, m.index);
      pos = m.index + m[0].length;

      if (t === 'rule') {
        const gi = m.slice(2).findIndex((g) => g !== undefined);
        const rule = rb.list[gi];
        const to = rule.to == null ? '' : String(rule.to);
        if (to === m[0]) {
          out += m[0];
        } else {
          changes.push({ start: out.length, end: out.length + to.length, from: m[0], to, type: 'rule', ruleId: rule.id });
          out += to;
        }
      } else {
        const form = cb.formOf.get(m[2]);
        const num = convertNumber(m[1], form);
        const to = num + m[2];
        if (to === m[0]) {
          out += m[0];
        } else {
          changes.push({ start: out.length, end: out.length + to.length, from: m[0], to, type: 'counter', counter: m[2] });
          out += to;
        }
      }
    }
    out += text.slice(pos);
    return { text: out, changes };
  }

  // 原稿に出てくる要注意語を探す。list は watchwords.js の形式。
  // 返り値: [{ word, readings, hint, count, registeredTo }]（registeredTo は登録済みの変換先。なければ null）
  function findWatch(input, list, rules) {
    const text = typeof input === 'string' ? input : '';
    const out = [];
    (list || []).forEach((w) => {
      if (!w || !w.word) return;
      const guard = /^[0-9０-９]/.test(w.word) ? '(?<![0-9０-９])' : '';
      const m = text.match(new RegExp(guard + escRe(w.word), 'g'));
      if (!m) return;
      const reg = (rules || []).find((r) => r && r.enabled !== false && r.from === w.word);
      out.push({ word: w.word, readings: w.readings || [], hint: w.hint || '', count: m.length, registeredTo: reg ? String(reg.to) : null });
    });
    return out;
  }

  // 「元 → 先」の複数行を解析する。区切りは → -> => = ＝ , ， タブ のどれでも可（最初の1つだけを区切りとみなす）
  // 返り値: { pairs: [{from, to}], skipped: 区切りが見つからず読み飛ばした行数 }
  function parsePairs(input) {
    const pairs = [];
    let skipped = 0;
    String(input || '').split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const m = line.match(/^(.*?)\s*(?:→|->|=>|＝|=|\t|，|,)\s*(.*)$/);
      if (!m || !m[1].trim()) { skipped++; return; }
      pairs.push({ from: m[1].trim(), to: m[2].trim() });
    });
    return { pairs, skipped };
  }

  // 数字の形式のデフォルト一覧（よく使う単位。どれも既定は「そのまま」。使う人が自分で選ぶ）
  const DEFAULT_COUNTERS = [
    { counter: '日間', form: 'keep' },
    { counter: '個', form: 'keep' },
    { counter: '週間', form: 'keep' },
    { counter: 'か月', form: 'keep' },
    { counter: 'ヶ月', form: 'keep' },
    { counter: '年間', form: 'keep' },
    { counter: '時間', form: 'keep' },
    { counter: '分', form: 'keep' },
    { counter: '秒', form: 'keep' },
    { counter: '回', form: 'keep' },
    { counter: '本', form: 'keep' },
    { counter: '枚', form: 'keep' },
    { counter: '冊', form: 'keep' },
    { counter: '件', form: 'keep' },
    { counter: '台', form: 'keep' },
    { counter: '円', form: 'keep' },
  ];

  return { apply, findWatch, parsePairs, convertNumber, kanjiToInt, intToKanji, DEFAULT_COUNTERS };
});
