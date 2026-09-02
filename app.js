/**
 * ねんねログ — 子供の睡眠記録アプリ
 *
 * 1件の記録は「ベットに入った時間 / 寝た時間 / 起きた時間」の3つの時刻を持つ。
 * 日付は "ベットに入った日" を基準にし、日付をまたぐ時刻は自動で翌日として扱う。
 * データはブラウザの localStorage にのみ保存する。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'nenne-log.v1';
  var DOW = ['日', '月', '火', '水', '木', '金', '土'];

  // ---------------------------------------------------------------- state

  var store = load();
  var ui = {
    editingId: null,
    range: '7' // '7' | '30' | 'all'
  };

  function defaultStore() {
    return {
      version: 1,
      children: [{ id: newId(), name: 'こども' }],
      activeChildId: null,
      records: []
    };
  }

  function load() {
    var data;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) {
      data = null;
    }
    if (!data || !Array.isArray(data.children) || !Array.isArray(data.records)) {
      data = defaultStore();
    }
    if (data.children.length === 0) data.children = defaultStore().children;
    if (!data.children.some(function (c) { return c.id === data.activeChildId; })) {
      data.activeChildId = data.children[0].id;
    }
    return data;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      toast('保存できませんでした（ブラウザの保存容量やプライベートモードをご確認ください）');
    }
  }

  function newId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ------------------------------------------------------------ time utils

  /** "HH:MM" -> 0時からの分。不正なら null。 */
  function toMinutes(hhmm) {
    if (!hhmm) return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    var h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  /** 基準日0時からの分 -> "HH:MM"（24時間以上は翌日として扱う） */
  function minutesToClock(min) {
    var v = ((min % 1440) + 1440) % 1440;
    return pad(Math.floor(v / 60)) + ':' + pad(v % 60);
  }

  /** 基準日0時からの分 -> "翌 06:30" のような表示 */
  function minutesToLabel(min) {
    var day = Math.floor(min / 1440);
    var prefix = day === 1 ? '翌 ' : day > 1 ? '+' + day + '日 ' : '';
    return prefix + minutesToClock(min);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** 分数 -> "8時間30分" */
  function durationText(min) {
    if (min === null || min === undefined) return '—';
    var sign = min < 0 ? '-' : '';
    var v = Math.abs(Math.round(min));
    var h = Math.floor(v / 60), m = v % 60;
    if (h === 0) return sign + m + '分';
    if (m === 0) return sign + h + '時間';
    return sign + h + '時間' + m + '分';
  }

  function todayStr(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function shiftDate(dateStr, days) {
    var p = parseDate(dateStr);
    if (!p) return dateStr;
    p.setDate(p.getDate() + days);
    return p.getFullYear() + '-' + pad(p.getMonth() + 1) + '-' + pad(p.getDate());
  }

  /** "YYYY-MM-DD" -> ローカルの Date（不正なら null） */
  function parseDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(dateStr) {
    var d = parseDate(dateStr);
    if (!d) return dateStr;
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function dowOf(dateStr) {
    var d = parseDate(dateStr);
    return d ? DOW[d.getDay()] : '';
  }

  // ------------------------------------------------------- record analysis

  /**
   * 3つの時刻を「基準日0時からの通算分」に展開する。
   * 前の時刻より小さければ日付をまたいだとみなして +24時間する。
   * 起床は入眠と同時刻でも翌日扱い（0分睡眠を避ける）。
   */
  function analyze(rec) {
    var inBed = toMinutes(rec.inBed);
    var asleep = toMinutes(rec.asleep);
    var wake = toMinutes(rec.wake);

    var prev = null;
    if (inBed !== null) prev = inBed;

    if (asleep !== null && prev !== null && asleep < prev) asleep += 1440;
    if (asleep !== null) prev = asleep;

    if (wake !== null && prev !== null && wake <= prev) {
      wake += 1440 * Math.ceil((prev - wake + 1) / 1440);
    }

    var latency = (inBed !== null && asleep !== null) ? asleep - inBed : null;
    var sleep = (asleep !== null && wake !== null) ? wake - asleep : null;
    var inBedTotal = (inBed !== null && wake !== null) ? wake - inBed : null;

    return {
      inBed: inBed, asleep: asleep, wake: wake,
      latency: latency, sleep: sleep, inBedTotal: inBedTotal,
      start: inBed !== null ? inBed : (asleep !== null ? asleep : wake),
      end: wake !== null ? wake : (asleep !== null ? asleep : inBed)
    };
  }

  function activeRecords() {
    return store.records
      .filter(function (r) { return r.childId === store.activeChildId; })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        var sa = analyze(a).start, sb = analyze(b).start;
        return (sb === null ? -1 : sb) - (sa === null ? -1 : sa);
      });
  }

  function rangedRecords() {
    var all = activeRecords();
    if (ui.range === 'all') return all;
    var limit = shiftDate(todayStr(), -(Number(ui.range) - 1));
    return all.filter(function (r) { return r.date >= limit; });
  }

  function activeChild() {
    return store.children.filter(function (c) { return c.id === store.activeChildId; })[0];
  }

  // ------------------------------------------------------------------ dom

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    childSelect: $('child-select'),
    form: $('record-form'),
    id: $('record-id'),
    date: $('f-date'),
    inBed: $('f-inbed'),
    asleep: $('f-asleep'),
    wake: $('f-wake'),
    note: $('f-note'),
    preview: $('form-preview'),
    error: $('form-error'),
    submitBtn: $('submit-btn'),
    cancelEdit: $('cancel-edit'),
    formModeLabel: $('form-mode-label'),
    stats: $('stats'),
    chart: $('chart'),
    list: $('record-list'),
    toast: $('toast')
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2600);
  }

  // ----------------------------------------------------------- rendering

  function renderChildren() {
    el.childSelect.innerHTML = store.children.map(function (c) {
      return '<option value="' + escapeHtml(c.id) + '"' +
        (c.id === store.activeChildId ? ' selected' : '') + '>' +
        escapeHtml(c.name) + '</option>';
    }).join('');
  }

  function renderStats() {
    var recs = rangedRecords();
    var sleeps = [], latencies = [], asleeps = [], wakes = [];

    recs.forEach(function (r) {
      var a = analyze(r);
      if (a.sleep !== null) sleeps.push(a.sleep);
      if (a.latency !== null) latencies.push(a.latency);
      if (a.asleep !== null) asleeps.push(a.asleep);
      if (a.wake !== null) wakes.push(a.wake);
    });

    var avg = function (arr) {
      if (!arr.length) return null;
      return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
    };

    var cards = [
      { label: '記録数', value: recs.length + '<small> 件</small>' },
      { label: '平均睡眠時間', value: sleeps.length ? durationText(avg(sleeps)) : '—' },
      { label: '平均 寝つき', value: latencies.length ? durationText(avg(latencies)) : '—' },
      { label: '平均 就寝時刻', value: asleeps.length ? minutesToClock(Math.round(avg(asleeps))) : '—' },
      { label: '平均 起床時刻', value: wakes.length ? minutesToClock(Math.round(avg(wakes))) : '—' }
    ];

    el.stats.innerHTML = cards.map(function (c) {
      return '<div class="stat"><span class="stat__label">' + c.label + '</span>' +
        '<span class="stat__value">' + c.value + '</span></div>';
    }).join('');
  }

  function renderChart() {
    var recs = rangedRecords().filter(function (r) {
      var a = analyze(r);
      return a.start !== null && a.end !== null && a.end > a.start;
    }).slice(0, 21).reverse();

    if (!recs.length) {
      el.chart.innerHTML = '<p class="chart__empty">グラフに表示できる記録がまだありません。</p>';
      return;
    }

    var min = Infinity, max = -Infinity;
    recs.forEach(function (r) {
      var a = analyze(r);
      min = Math.min(min, a.start);
      max = Math.max(max, a.end);
    });
    min = Math.floor(min / 60) * 60;
    max = Math.ceil(max / 60) * 60;
    if (max - min < 240) max = min + 240;
    var span = max - min;

    var step = 120;
    if (span > 900) step = 180;
    if (span > 1400) step = 240;
    var firstTick = Math.ceil(min / step) * step;

    var pct = function (minutes) { return ((minutes - min) / span) * 100; };

    var ticks = [];
    for (var t = firstTick; t <= max; t += step) ticks.push(t);

    var axis = '<div class="chart__axis">' + ticks.map(function (t) {
      return '<span class="chart__tick" style="left:' + pct(t).toFixed(2) + '%">' +
        minutesToClock(t) + '</span>';
    }).join('') + '</div>';

    var gridHtml = ticks.map(function (t) {
      return '<span class="chart__grid" style="left:' + pct(t).toFixed(2) + '%"></span>';
    }).join('');

    var rows = recs.map(function (r) {
      var a = analyze(r);
      var bars = '';
      if (a.latency !== null && a.latency > 0) {
        bars += '<span class="chart__bar chart__bar--latency" style="left:' +
          pct(a.inBed).toFixed(2) + '%;width:' + ((a.latency / span) * 100).toFixed(2) + '%"></span>';
      }
      if (a.sleep !== null) {
        bars += '<span class="chart__bar chart__bar--sleep" style="left:' +
          pct(a.asleep).toFixed(2) + '%;width:' + ((a.sleep / span) * 100).toFixed(2) + '%"></span>';
      } else {
        bars += '<span class="chart__bar chart__bar--latency" style="left:' +
          pct(a.start).toFixed(2) + '%;width:' + (((a.end - a.start) / span) * 100).toFixed(2) + '%"></span>';
      }
      var title = formatDate(r.date) + '（' + dowOf(r.date) + '） ' +
        (a.sleep !== null ? '睡眠 ' + durationText(a.sleep) : '睡眠時間 未算出');
      return '<div class="chart__row">' +
        '<span class="chart__label">' + formatDate(r.date) + '（' + dowOf(r.date) + '）</span>' +
        '<span class="chart__track" title="' + escapeHtml(title) + '">' + gridHtml + bars + '</span>' +
        '</div>';
    }).join('');

    el.chart.innerHTML = axis + rows;
  }

  function renderList() {
    var recs = rangedRecords();
    if (!recs.length) {
      el.list.innerHTML = '<p class="empty">まだ記録がありません。上のフォームから登録してください。</p>';
      return;
    }

    el.list.innerHTML = recs.map(function (r) {
      var a = analyze(r);
      var times = [
        '<span>🛏 ' + (r.inBed ? r.inBed : '—') + '</span>',
        '<span>😴 ' + (a.asleep !== null ? minutesToLabel(a.asleep) : '—') + '</span>',
        '<span>☀️ ' + (a.wake !== null ? minutesToLabel(a.wake) : '—') + '</span>'
      ].join('');

      var meta = [];
      if (a.latency !== null) meta.push('寝つき ' + durationText(a.latency));
      if (a.inBedTotal !== null) meta.push('ベット滞在 ' + durationText(a.inBedTotal));

      return '<article class="record' + (r.id === ui.editingId ? ' record--editing' : '') + '" data-id="' + escapeHtml(r.id) + '">' +
        '<div class="record__head">' +
          '<div><span class="record__date">' + formatDate(r.date) + '</span> ' +
          '<span class="record__dow">（' + dowOf(r.date) + '）</span></div>' +
          '<span class="record__total">' + (a.sleep !== null ? '睡眠 ' + durationText(a.sleep) : '') + '</span>' +
        '</div>' +
        '<div class="record__times">' + times + '</div>' +
        (meta.length ? '<div class="record__meta">' + meta.join(' ／ ') + '</div>' : '') +
        (r.note ? '<div class="record__note">' + escapeHtml(r.note) + '</div>' : '') +
        '<div class="record__actions">' +
          '<button type="button" class="btn" data-action="edit">編集</button>' +
          '<button type="button" class="btn btn--danger" data-action="delete">削除</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function renderAll() {
    renderChildren();
    renderStats();
    renderChart();
    renderList();
  }

  // ---------------------------------------------------------------- form

  function updatePreview() {
    var a = analyze({ inBed: el.inBed.value, asleep: el.asleep.value, wake: el.wake.value });
    var parts = [];
    if (a.latency !== null) parts.push('寝つきまで ' + durationText(a.latency));
    if (a.sleep !== null) parts.push('睡眠時間 ' + durationText(a.sleep));
    if (a.wake !== null && a.wake >= 1440) parts.push('起床は翌日');

    var dupe = !ui.editingId && el.date.value && store.records.some(function (r) {
      return r.childId === store.activeChildId && r.date === el.date.value;
    });
    if (dupe) parts.push('※この日はすでに記録があります');

    el.preview.textContent = parts.join(' ／ ');
  }

  function resetForm(keepDate) {
    var date = keepDate ? el.date.value : defaultDate();
    ui.editingId = null;
    el.id.value = '';
    el.form.reset();
    el.date.value = date;
    el.note.value = '';
    el.error.textContent = '';
    el.submitBtn.textContent = '保存する';
    el.cancelEdit.hidden = true;
    el.formModeLabel.textContent = 'きろくする';
    updatePreview();
  }

  /** 午前中は「前日の夜の記録」を付けることが多いので、既定日を前日にする。 */
  function defaultDate() {
    return new Date().getHours() < 12 ? todayStr(-1) : todayStr();
  }

  function startEdit(id) {
    var rec = store.records.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;
    ui.editingId = id;
    el.id.value = rec.id;
    el.date.value = rec.date;
    el.inBed.value = rec.inBed || '';
    el.asleep.value = rec.asleep || '';
    el.wake.value = rec.wake || '';
    el.note.value = rec.note || '';
    el.error.textContent = '';
    el.submitBtn.textContent = '更新する';
    el.cancelEdit.hidden = false;
    el.formModeLabel.textContent = 'きろくを編集';
    updatePreview();
    renderList();
    el.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onSubmit(e) {
    e.preventDefault();
    el.error.textContent = '';

    var date = el.date.value;
    var rec = {
      date: date,
      inBed: el.inBed.value || '',
      asleep: el.asleep.value || '',
      wake: el.wake.value || '',
      note: el.note.value.trim()
    };

    if (!parseDate(date)) {
      el.error.textContent = '日付を入力してください。';
      return;
    }
    if (!rec.inBed && !rec.asleep && !rec.wake) {
      el.error.textContent = '時間を1つ以上入力してください。';
      return;
    }
    var a = analyze(rec);
    if (a.sleep !== null && a.sleep > 20 * 60) {
      el.error.textContent = '睡眠時間が20時間を超えています。時刻をご確認ください。';
      return;
    }
    if (a.latency !== null && a.latency > 12 * 60) {
      el.error.textContent = '寝つきまでが12時間を超えています。時刻をご確認ください。';
      return;
    }

    if (ui.editingId) {
      store.records.forEach(function (r) {
        if (r.id !== ui.editingId) return;
        r.date = rec.date;
        r.inBed = rec.inBed;
        r.asleep = rec.asleep;
        r.wake = rec.wake;
        r.note = rec.note;
        r.updatedAt = new Date().toISOString();
      });
      toast('記録を更新しました');
    } else {
      rec.id = newId();
      rec.childId = store.activeChildId;
      rec.createdAt = rec.updatedAt = new Date().toISOString();
      store.records.push(rec);
      toast('記録を保存しました');
    }

    save();
    resetForm(true);
    renderAll();
  }

  // ------------------------------------------------------------- 子供管理

  function addChild() {
    var name = (prompt('お子さんの名前を入力してください') || '').trim();
    if (!name) return;
    var child = { id: newId(), name: name };
    store.children.push(child);
    store.activeChildId = child.id;
    save();
    resetForm();
    renderAll();
    toast(name + ' を追加しました');
  }

  function renameChild() {
    var child = activeChild();
    if (!child) return;
    var name = (prompt('名前を変更', child.name) || '').trim();
    if (!name) return;
    child.name = name;
    save();
    renderChildren();
    toast('名前を変更しました');
  }

  function deleteChild() {
    var child = activeChild();
    if (!child) return;
    if (store.children.length <= 1) {
      toast('お子さんが1人のときは削除できません');
      return;
    }
    var count = store.records.filter(function (r) { return r.childId === child.id; }).length;
    if (!confirm(child.name + ' と、その記録 ' + count + ' 件をすべて削除します。よろしいですか？')) return;

    store.records = store.records.filter(function (r) { return r.childId !== child.id; });
    store.children = store.children.filter(function (c) { return c.id !== child.id; });
    store.activeChildId = store.children[0].id;
    save();
    resetForm();
    renderAll();
    toast('削除しました');
  }

  // -------------------------------------------------------- 書き出し / 復元

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var child = activeChild();
    var rows = [['お子さん', '日付', '曜日', 'ベットに入った時間', '寝た時間', '起きた時間',
      '寝つきまで(分)', '睡眠時間(分)', '睡眠時間', 'メモ']];

    activeRecords().slice().reverse().forEach(function (r) {
      var a = analyze(r);
      rows.push([
        child ? child.name : '',
        r.date,
        dowOf(r.date),
        r.inBed || '',
        a.asleep !== null ? minutesToLabel(a.asleep) : '',
        a.wake !== null ? minutesToLabel(a.wake) : '',
        a.latency !== null ? a.latency : '',
        a.sleep !== null ? a.sleep : '',
        a.sleep !== null ? durationText(a.sleep) : '',
        r.note || ''
      ]);
    });

    if (rows.length === 1) { toast('書き出す記録がありません'); return; }

    var csv = '﻿' + rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
    download('nenne-log_' + (child ? child.name : 'child') + '_' + todayStr() + '.csv',
      csv, 'text/csv;charset=utf-8');
  }

  function exportJson() {
    download('nenne-log-backup_' + todayStr() + '.json',
      JSON.stringify(store, null, 2), 'application/json');
    toast('バックアップを書き出しました');
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (e) {
        toast('ファイルを読み込めませんでした');
        return;
      }
      if (!data || !Array.isArray(data.children) || !Array.isArray(data.records)) {
        toast('バックアップファイルの形式が正しくありません');
        return;
      }
      if (!confirm('現在のデータをこのバックアップで置き換えます。よろしいですか？')) return;
      store = data;
      if (!store.children.length) store.children = defaultStore().children;
      if (!store.children.some(function (c) { return c.id === store.activeChildId; })) {
        store.activeChildId = store.children[0].id;
      }
      save();
      resetForm();
      renderAll();
      toast('データを復元しました');
    };
    reader.readAsText(file);
  }

  // -------------------------------------------------------------- events

  el.form.addEventListener('submit', onSubmit);
  el.cancelEdit.addEventListener('click', function () {
    resetForm();
    renderList();
  });

  [el.inBed, el.asleep, el.wake, el.date].forEach(function (input) {
    input.addEventListener('change', updatePreview);
    input.addEventListener('input', updatePreview);
  });

  document.querySelectorAll('[data-now]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var now = new Date();
      $(btn.dataset.now).value = pad(now.getHours()) + ':' + pad(now.getMinutes());
      updatePreview();
    });
  });

  document.querySelectorAll('[data-shift-date]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      el.date.value = shiftDate(el.date.value || todayStr(), Number(btn.dataset.shiftDate));
      updatePreview();
    });
  });

  el.childSelect.addEventListener('change', function () {
    store.activeChildId = el.childSelect.value;
    save();
    resetForm();
    renderAll();
  });
  $('child-add').addEventListener('click', addChild);
  $('child-rename').addEventListener('click', renameChild);
  $('child-delete').addEventListener('click', deleteChild);

  document.querySelectorAll('[data-range]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      ui.range = btn.dataset.range;
      document.querySelectorAll('[data-range]').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.range === ui.range));
      });
      renderAll();
    });
  });

  el.list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.closest('.record').dataset.id;
    if (btn.dataset.action === 'edit') {
      startEdit(id);
    } else if (btn.dataset.action === 'delete') {
      var rec = store.records.filter(function (r) { return r.id === id; })[0];
      if (!rec) return;
      if (!confirm(formatDate(rec.date) + ' の記録を削除します。よろしいですか？')) return;
      store.records = store.records.filter(function (r) { return r.id !== id; });
      if (ui.editingId === id) resetForm();
      save();
      renderAll();
      toast('記録を削除しました');
    }
  });

  $('export-csv').addEventListener('click', exportCsv);
  $('export-json').addEventListener('click', exportJson);
  $('import-json').addEventListener('click', function () { $('import-file').click(); });
  $('import-file').addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  // ----------------------------------------------------------------- init

  document.querySelectorAll('[data-range]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.range === ui.range));
  });
  resetForm();
  renderAll();
})();
