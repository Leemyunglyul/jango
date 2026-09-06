/**
 * 잔고와 흐름 — Google 스프레드시트 백엔드
 *
 * 설치는 README-시트연결.md 참고. 요약하면:
 *  1) 새 스프레드시트 → 확장 프로그램 → Apps Script
 *  2) 이 파일 내용을 통째로 붙여넣기
 *  3) 프로젝트 설정 → 스크립트 속성에 TOKEN 추가
 *  4) 배포 → 새 배포 → 웹 앱 / 실행: 나 / 액세스: 모든 사용자
 */

var SH_TX = "거래", SH_SET = "설정", SH_AS = "자산", SH_SNAP = "스냅샷";

var TX_HEAD   = ["날짜", "월", "구분", "분류", "금액", "메모", "일회성", "ID", "분류ID"];
var AS_HEAD   = ["이름", "구분", "평가액", "대출잔액", "월납입", "메모", "ID", "구분ID", "종목(JSON)"];
var SNAP_HEAD = ["월", "현금", "투자", "부동산", "연금", "보험", "부채", "순자산", "기록일"];
var SET_HEAD  = ["키", "값(JSON)"];

/* ── 엔트리 포인트 ────────────────────────────────────────── */

function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    var p = (e && e.parameter) || {};

    var want = PropertiesService.getScriptProperties().getProperty("TOKEN");
    if (!want) return out({ ok: false, error: "스크립트 속성 TOKEN이 비어 있습니다. 설치 4단계를 확인하세요." });
    if ((body.token || p.token || "") !== want) return out({ ok: false, error: "토큰이 일치하지 않습니다." });

    var action = body.action || p.action || "load";

    if (action === "ping") return out({ ok: true, name: ss().getName(), rev: getRev() });
    if (action === "load") return out({ ok: true, rev: getRev(), data: readAll() });

    if (action === "save") {
      var lock = LockService.getScriptLock();
      lock.waitLock(25000);
      try {
        writeParts(body.parts || {});
        setRev(Number(body.rev) || (getRev() + 1));
      } finally {
        lock.releaseLock();
      }
      return out({ ok: true, rev: getRev() });
    }
    return out({ ok: false, error: "알 수 없는 action: " + action });
  } catch (err) {
    return out({ ok: false, error: String((err && err.message) || err) });
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── 시트 헬퍼 ────────────────────────────────────────────── */

function ss() { return SpreadsheetApp.getActive(); }
function tz() { return ss().getSpreadsheetTimeZone() || "Asia/Seoul"; }

function sheet(name, head) {
  var s = ss().getSheetByName(name);
  if (!s) s = ss().insertSheet(name);
  if (s.getLastRow() === 0) {
    s.getRange(1, 1, 1, head.length).setValues([head])
      .setFontWeight("bold").setBackground("#EFEDE4");
    s.setFrozenRows(1);
  }
  return s;
}
function clearBody(s, cols) {
  var last = s.getLastRow();
  if (last > 1) s.getRange(2, 1, last - 1, cols).clearContent();
}
function getRev() {
  return Number(PropertiesService.getScriptProperties().getProperty("REV") || 0);
}
function setRev(n) {
  PropertiesService.getScriptProperties().setProperty("REV", String(n));
}
function toISO(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz(), "yyyy-MM-dd");
  return String(v || "").slice(0, 10);
}
function toDate(s) {
  try { return Utilities.parseDate(String(s).slice(0, 10), tz(), "yyyy-MM-dd"); }
  catch (e) { return String(s); }
}

/* ── 읽기 ────────────────────────────────────────────────── */

function readAll() {
  return {
    settings: readSettings(),
    months:   readTx(),
    assets:   readAssets(),
    snaps:    readSnaps()
  };
}

function readSettings() {
  var s = sheet(SH_SET, SET_HEAD), n = s.getLastRow(), o = {};
  if (n < 2) return o;
  s.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) {
    if (!r[0]) return;
    try { o[String(r[0])] = JSON.parse(r[1]); } catch (e) {}
  });
  return o;
}

function readTx() {
  var s = sheet(SH_TX, TX_HEAD), n = s.getLastRow(), months = {};
  if (n < 2) return months;
  s.getRange(2, 1, n - 1, TX_HEAD.length).getValues().forEach(function (r) {
    var d = toISO(r[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    var ym = d.slice(0, 7);
    if (!months[ym]) months[ym] = { items: [] };
    months[ym].items.push({
      id: String(r[7] || ""),
      d:  d,
      k:  String(r[2]).indexOf("수입") >= 0 ? "in" : "ex",
      c:  String(r[8] || ""),
      a:  Number(r[4]) || 0,
      m:  String(r[5] || ""),
      o:  String(r[6] || "").toUpperCase() === "Y"
    });
  });
  return months;
}

function readAssets() {
  var s = sheet(SH_AS, AS_HEAD), n = s.getLastRow(), list = [];
  if (n < 2) return list;
  s.getRange(2, 1, n - 1, AS_HEAD.length).getValues().forEach(function (r) {
    if (!r[0] && !r[6]) return;
    var holds = [];
    try { holds = JSON.parse(r[8] || "[]") || []; } catch (e) {}
    list.push({
      id:       String(r[6] || ""),
      name:     String(r[0] || ""),
      group:    String(r[7] || "cash"),
      value:    Number(r[2]) || 0,
      loan:     Number(r[3]) || 0,
      monthly:  Number(r[4]) || 0,
      note:     String(r[5] || ""),
      holdings: holds
    });
  });
  return list;
}

function readSnaps() {
  var s = sheet(SH_SNAP, SNAP_HEAD), n = s.getLastRow(), map = {};
  if (n < 2) return map;
  s.getRange(2, 1, n - 1, SNAP_HEAD.length).getValues().forEach(function (r) {
    var ym = String(r[0] || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    map[ym] = {
      cash:    Number(r[1]) || 0,
      invest:  Number(r[2]) || 0,
      real:    Number(r[3]) || 0,
      pension: Number(r[4]) || 0,
      insure:  Number(r[5]) || 0,
      debt:    Number(r[6]) || 0,
      total:   Number(r[7]) || 0,
      at:      toISO(r[8])
    };
  });
  return map;
}

/* ── 쓰기 ────────────────────────────────────────────────── */

function writeParts(parts) {
  if (parts.settings) writeSettings(parts.settings);
  if (parts.tx)       writeTx(parts.tx);
  if (parts.assets)   writeAssets(parts.assets);
  if (parts.snaps)    writeSnaps(parts.snaps);
}

function writeSettings(obj) {
  var s = sheet(SH_SET, SET_HEAD);
  clearBody(s, SET_HEAD.length);
  var rows = Object.keys(obj).map(function (k) { return [k, JSON.stringify(obj[k])]; });
  if (!rows.length) return;
  s.getRange(2, 1, rows.length, 2).setValues(rows);
  s.setColumnWidth(1, 110);
}

function writeTx(rows) {
  var s = sheet(SH_TX, TX_HEAD);
  clearBody(s, TX_HEAD.length);
  if (!rows || !rows.length) return;
  var vals = rows.map(function (r) {
    return [
      toDate(r.d),
      String(r.d).slice(0, 7),
      r.k === "in" ? "수입" : "지출",
      r.cn || "",
      Number(r.a) || 0,
      r.m || "",
      r.o ? "Y" : "",
      r.id || "",
      r.c || ""
    ];
  });
  s.getRange(2, 1, vals.length, TX_HEAD.length).setValues(vals);
  s.getRange(2, 1, vals.length, 1).setNumberFormat("yyyy-mm-dd");
  s.getRange(2, 5, vals.length, 1).setNumberFormat("#,##0");
}

function writeAssets(list) {
  var s = sheet(SH_AS, AS_HEAD);
  clearBody(s, AS_HEAD.length);
  if (!list || !list.length) return;
  var vals = list.map(function (a) {
    return [
      a.name || "", a.gn || a.group || "", Number(a.value) || 0,
      Number(a.loan) || 0, Number(a.monthly) || 0, a.note || "",
      a.id || "", a.group || "", JSON.stringify(a.holdings || [])
    ];
  });
  s.getRange(2, 1, vals.length, AS_HEAD.length).setValues(vals);
  s.getRange(2, 3, vals.length, 3).setNumberFormat("#,##0");
}

function writeSnaps(map) {
  var s = sheet(SH_SNAP, SNAP_HEAD);
  clearBody(s, SNAP_HEAD.length);
  var keys = Object.keys(map || {}).sort();
  if (!keys.length) return;
  var vals = keys.map(function (ym) {
    var v = map[ym] || {};
    return [ym, Number(v.cash) || 0, Number(v.invest) || 0, Number(v.real) || 0,
            Number(v.pension) || 0, Number(v.insure) || 0, Number(v.debt) || 0,
            Number(v.total) || 0, v.at || ""];
  });
  s.getRange(2, 1, vals.length, SNAP_HEAD.length).setValues(vals);
  s.getRange(2, 2, vals.length, 7).setNumberFormat("#,##0");
}
