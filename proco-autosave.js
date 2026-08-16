/**
 * PROCO 자동 저장 v3  (v2 + [제출] 신호: 현재 노트북을 그대로 제출본으로 올림)
 * ---------------------------------------------------------------------------
 * 주피터라이트 화면(lab/index.html)에 빌드 단계에서 끼워 넣는 스크립트입니다.
 *
 * v1은 브라우저 저장소(IndexedDB)를 직접 만졌다가 부팅을 방해했습니다.
 * v2는 앱이 다 켜진 뒤, 주피터랩의 정식 파일 API(serviceManager.contents)만 씁니다.
 * 그래서 부팅에 끼어들 일이 없습니다.
 *
 *  1. 앱이 켜지면 mywork.ipynb 가 없을 때 만들어 둡니다.
 *     서버 저장본이 있으면 그것을, 없으면 template.ipynb 를 바탕으로.
 *  2. 10분마다 mywork.ipynb 를 읽어 바뀌었을 때만 서버로 보냅니다.
 *  3. 기록지의 [불러오기] 신호(postMessage)를 받아 저장본으로 되돌립니다.
 *
 * 개인 코드와 서버 주소는 기록지가 iframe 주소 뒤에 붙여 줍니다.
 *   lab/index.html?proco=개인코드&api=배포주소
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  var FILE = "mywork.ipynb";
  var 주기 = 10 * 60 * 1000; // 10분
  var 상태 = { 해시: null, contents: null };

  /* ---------- 개인 코드와 서버 주소 ---------- */
  var q = new URLSearchParams(location.search);
  if (q.get("proco")) localStorage.setItem("proco_code", q.get("proco"));
  if (q.get("api"))   localStorage.setItem("proco_api",  q.get("api"));
  var CODE = localStorage.getItem("proco_code");
  var API  = localStorage.getItem("proco_api");
  if (!CODE || !API) { console.log("[PROCO] 개인 코드가 없어 자동 저장을 쉽니다."); return; }

  /* ---------- 서버와 주고받기 ---------- */
  function 서버에서(kind) {
    return fetch(API + "?api=load&code=" + encodeURIComponent(CODE) + "&kind=" + kind)
      .then(function (r) { return r.json(); });
  }
  function 서버로(문자열, 방식) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "save", code: CODE, content: 문자열, mode: 방식 || "auto" })
    }).then(function (r) { return r.json(); });
  }

  /* ---------- 파일 읽고 쓰기 (주피터랩 정식 API) ---------- */
  function 파일읽기() {
    return 상태.contents.get(FILE, { content: true });
  }
  function 파일쓰기(내용객체) {
    return 상태.contents.save(FILE, { type: "notebook", format: "json", content: 내용객체 });
  }

  /* ---------- 1. 처음 준비 ---------- */
  async function 준비() {
    try {
      await 파일읽기();
      console.log("[PROCO] mywork.ipynb 가 이미 있습니다.");
      return;
    } catch (e) { /* 없음 → 만든다 */ }

    try {
      var r = await 서버에서("auto");
      if (r && r.ok && r.exists) {
        await 파일쓰기(JSON.parse(r.content));
        console.log("[PROCO] 서버 저장본으로 mywork.ipynb 를 만들었습니다.");
        return;
      }
    } catch (e) { console.warn("[PROCO] 서버 확인 실패:", e); }

    try {
      var t = await fetch(API + "/api/template");                 // 워커에 내장된 템플릿
      if (!t.ok) t = await fetch(new URL("../files/template.ipynb", location.href)); // 예비
      await 파일쓰기(await t.json());
      console.log("[PROCO] 템플릿으로 mywork.ipynb 를 만들었습니다.");
    } catch (e) { console.warn("[PROCO] 템플릿을 가져오지 못했습니다:", e); }
  }

  /* ---------- 2. 10분마다 자동 저장 ---------- */
  function 해시(s) {
    var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return h + ":" + s.length;
  }
  async function 저장시도() {
    if (!상태.contents) return "대기중";
    try {
      var m = await 파일읽기();
      var s = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      var h = 해시(s);
      if (h === 상태.해시) return "변화없음";
      var r = await 서버로(s);
      if (r && r.ok) { 상태.해시 = h; console.log("[PROCO] 자동 저장", r.time); return "저장됨"; }
      console.warn("[PROCO] 저장 실패:", r && r.error); return "실패";
    } catch (e) { console.warn("[PROCO] 저장 중 오류:", e); return "오류"; }
  }

  /* ---------- 3. 기록지의 [불러오기]·[제출] 신호 ---------- */
  window.addEventListener("message", async function (ev) {
    var m = ev.data;
    if (!m || !상태.contents) return;

    // [제출] — 지금 노트북의 mywork.ipynb 를 그대로 서버에 올립니다.
    if (m.proco === "push") {
      try {
        var f = await 파일읽기();
        var s2 = typeof f.content === "string" ? f.content : JSON.stringify(f.content);
        var r2 = await 서버로(s2, "manual");
        상태.해시 = null;   // 다음 자동 저장 때 다시 비교하도록
        ev.source && ev.source.postMessage(
          { proco: "push-result", ok: !!(r2 && r2.ok), time: r2 && r2.time, error: r2 && r2.error }, "*");
      } catch (e) {
        ev.source && ev.source.postMessage({ proco: "push-result", ok: false, error: String(e) }, "*");
      }
      return;
    }

    if (m.proco !== "load") return;
    try {
      var r = await 서버에서(m.kind === "manual" ? "manual" : "auto");
      if (!r.ok || !r.exists) {
        ev.source && ev.source.postMessage({ proco: "load-result", ok: false, error: r.error || "저장본 없음" }, "*");
        return;
      }
      await 파일쓰기(JSON.parse(r.content));
      상태.해시 = null;
      ev.source && ev.source.postMessage({ proco: "load-result", ok: true, kind: m.kind, time: r.time }, "*");
    } catch (e) {
      ev.source && ev.source.postMessage({ proco: "load-result", ok: false, error: String(e) }, "*");
    }
  });

  /* ---------- 앱이 켜질 때까지 기다렸다가 시작 ---------- */
  var 기다림 = setInterval(function () {
    var app = window.jupyterapp || window.jupyterlab;
    if (!app || !app.serviceManager) return;
    clearInterval(기다림);
    app.started.then(function () {
      상태.contents = app.serviceManager.contents;
      준비();
      setInterval(저장시도, 주기);
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") 저장시도();
      });
      console.log("[PROCO] 자동 저장 준비 완료 (10분마다)");
    });
  }, 400);
  // 2분이 지나도 앱을 못 찾으면 포기하고 로그만 남깁니다.
  setTimeout(function () { clearInterval(기다림); }, 120000);
})();
