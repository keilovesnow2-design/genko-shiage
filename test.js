// node test.js で実行。エンジンの基本動作を確認する。
const assert = require('assert');
const E = require('./public/engine');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
// 数字の書き方の設定（既定は「そのまま」なので、テスト側で明示する）
const C = [{ counter: '日間', form: 'arabic' }, { counter: '個', form: 'arabic' }];

t('初期設定の単位はどれも「そのまま」', () => {
  assert.ok(E.DEFAULT_COUNTERS.length > 0);
  assert.ok(E.DEFAULT_COUNTERS.every((c) => c.form === 'keep'));
  const s = '二十日間と十個';
  assert.strictEqual(E.apply(s, { rules: [], counters: E.DEFAULT_COUNTERS }).text, s);
});
t('何も登録しなければそのまま', () => {
  const s = '今日は晴れです。二十日間、十個。';
  assert.strictEqual(E.apply(s, { rules: [], counters: [] }).text, s);
});
t('固定ルール置換', () => {
  const r = E.apply('私の本を買う', { rules: [{ id: 'a', from: '本', to: 'ほん' }], counters: [] });
  assert.strictEqual(r.text, '私のほんを買う');
  assert.strictEqual(r.changes.length, 1);
});
t('長い一節が単語より優先', () => {
  const r = E.apply('本気出そう', { rules: [{ from: '本', to: 'ほん' }, { from: '本気出そう', to: 'ほんきだそう' }], counters: [] });
  assert.strictEqual(r.text, 'ほんきだそう');
});
t('置換後の文字は再置換されない', () => {
  const r = E.apply('あ', { rules: [{ from: 'あ', to: 'いあ' }], counters: [] });
  assert.strictEqual(r.text, 'いあ');
});
t('ゆるい一致（句読点・空白の差を無視）', () => {
  const r = E.apply('これは、 大事な一節です', { rules: [{ from: 'これは大事な一節です', to: 'OK', loose: true }], counters: [] });
  assert.strictEqual(r.text, 'OK');
});
t('置き換えた後が空のルールは書きかけとして使わない', () => {
  const r = E.apply('整理する', { rules: [{ from: '整理', to: '' }], counters: [] });
  assert.strictEqual(r.text, '整理する');
});
t('無効化したルールは使わない', () => {
  const r = E.apply('本', { rules: [{ from: '本', to: 'ほん', enabled: false }], counters: [] });
  assert.strictEqual(r.text, '本');
});
t('二十日間 → 20日間', () => {
  assert.strictEqual(E.apply('二十日間かかる', { rules: [], counters: C }).text, '20日間かかる');
});
t('十個 → 10個', () => {
  assert.strictEqual(E.apply('十個ある', { rules: [], counters: C }).text, '10個ある');
});
t('日付の二十日は触らない（助数詞は日間のみ）', () => {
  assert.strictEqual(E.apply('二十日に会う', { rules: [], counters: C }).text, '二十日に会う');
});
t('数十個・何百個・1.5個は触らない', () => {
  const s = '数十個と何百個と1.5個';
  assert.strictEqual(E.apply(s, { rules: [], counters: C }).text, s);
});
t('漢数字化（20日間 → 二十日間）', () => {
  assert.strictEqual(E.apply('20日間', { rules: [], counters: [{ counter: '日間', form: 'kanji' }] }).text, '二十日間');
});
t('ユーザールールが助数詞より優先', () => {
  const r = E.apply('十個', { rules: [{ from: '十個', to: 'じゅっこ' }], counters: C });
  assert.strictEqual(r.text, 'じゅっこ');
});
t('漢数字パース', () => {
  assert.strictEqual(E.kanjiToInt('二十'), 20);
  assert.strictEqual(E.kanjiToInt('三百五'), 305);
  assert.strictEqual(E.kanjiToInt('一万二千'), 12000);
  assert.strictEqual(E.kanjiToInt('二〇二五'), 2025);
  assert.strictEqual(E.intToKanji(12000), '一万二千');
  assert.strictEqual(E.intToKanji(110), '百十');
});
t('変更位置が出力と一致する', () => {
  const r = E.apply('A十個B', { rules: [], counters: C });
  assert.strictEqual(r.text.slice(r.changes[0].start, r.changes[0].end), '10個');
});

t('要注意語を検出し、登録済みを判別する', () => {
  const list = [{ word: '一日', readings: ['いちにち', 'ついたち'] }, { word: '1日', readings: ['いちにち'] }, { word: '市場', readings: ['しじょう'] }];
  const h = E.findWatch('一日中。11日と1日。一日', list, [{ from: '一日', to: 'いちにち' }]);
  assert.strictEqual(h.length, 2);
  assert.strictEqual(h[0].word, '一日');
  assert.strictEqual(h[0].count, 2);
  assert.strictEqual(h[0].registeredTo, 'いちにち');
  assert.strictEqual(h[1].word, '1日');
  assert.strictEqual(h[1].count, 1); // 「11日」の中の「1日」は数えない
  assert.strictEqual(h[1].registeredTo, null);
});
t('まとめて追加の解析', () => {
  const r = E.parsePairs('思考 → しこう\n二十日間=20日間\n本,ほん\nA\t B\n区切りなし\n\n→先だけ');
  assert.deepStrictEqual(r.pairs, [
    { from: '思考', to: 'しこう' }, { from: '二十日間', to: '20日間' }, { from: '本', to: 'ほん' }, { from: 'A', to: 'B' },
  ]);
  assert.strictEqual(r.skipped, 2);
});

t('場所ごとの指定：その場所だけそのまま／別の読みにできる', () => {
  const text = 'ほおに手を当てた。ほおが赤い。ほおを叩く。';
  const rules = [{ id: 'a', from: 'ほお', to: '頬', enabled: true }];
  const base = E.apply(text, { rules, counters: [] });
  assert.strictEqual(base.sites.length, 3);
  assert.strictEqual(base.text, '頬に手を当てた。頬が赤い。頬を叩く。');
  const s2 = base.sites[1];
  const keep = E.apply(text, { rules, counters: [], places: [{ from: 'ほお', ctx: s2.ctx, to: null }] });
  assert.strictEqual(keep.text, '頬に手を当てた。ほおが赤い。頬を叩く。');
  const other = E.apply(text, { rules, counters: [], places: [{ from: 'ほお', ctx: s2.ctx, to: '類' }] });
  assert.strictEqual(other.text, '頬に手を当てた。類が赤い。頬を叩く。');
});
t('登録がなくても、場所ごとに読みを決められる（watch で場所を取得）', () => {
  const text = '今日は晴れ。今日も晴れ。';
  const none = E.apply(text, { rules: [], counters: [] }, { watch: ['今日'] });
  assert.strictEqual(none.text, text);
  assert.strictEqual(none.sites.length, 2);
  assert.strictEqual(none.sites[0].global, null);
  const one = E.apply(text, { rules: [], counters: [], places: [{ from: '今日', ctx: none.sites[1].ctx, to: 'こんにち' }] });
  assert.strictEqual(one.text, '今日は晴れ。こんにちも晴れ。');
});
t('使わない設定のルールでも、場所の一覧には載る', () => {
  const r = E.apply('人気です。人気だ。', { rules: [{ id: 'a', from: '人気', to: 'にんき', enabled: false }], counters: [] }, { watch: ['人気'] });
  assert.strictEqual(r.text, '人気です。人気だ。');
  assert.strictEqual(r.sites.length, 2);
});

console.log(`\n${n} tests passed`);
