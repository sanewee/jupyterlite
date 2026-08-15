/**
 * PROCO 자동 저장
 * ---------------------------------------------------------------------------
 * 주피터라이트 화면(lab/index.html)에 빌드 단계에서 끼워 넣는 스크립트입니다.
 * 학생이 아무 셀도 실행하지 않아도 이 스크립트가 알아서 합니다.
 *
 *  1. 처음 열리면 mywork.ipynb 를 만들어 둡니다.
 *     서버에 저장본이 있으면 그것을, 없으면 template.ipynb 를 바탕으로.
 *  2. 10분마다 mywork.ipynb 를 읽어 바뀌었을 때만 서버로 보냅니다.
 *  3. 기록지의 [불러오기] 버튼이 보내는 신호(postMessage)를 받아
 *     자동/제출 저장본으로 되돌립니다.
 *
 * 개인 코드와 서버 주소는 기록지가 iframe 주소 뒤에 붙여 줍니다.
 *   lab/index.html?proco=개인코드&api=배포주소
 * 한 번 받으면 이 브라우저(localStorage)에 기억합니다.
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  var FILE = "mywork.ipynb";
  var DB = "JupyterLite Storage";   // 주피터라이트가 파일을 담아 두는 브라우저 저장소 이름
  var 주기 = 10 * 60 * 1000;        // 10분
  var 상태 = { 해시: null };

  /* ---------- 개인 코드와 서버 주소 ---------- */
  var q = new URLSearchParams(location.search);
  if (q.get("proco")) localStorage.setItem("proco_code", q.get("proco"));
  if (q.get("api"))   localStorage.setItem("proco_api",  q.get("api"));
  var CODE = localStorage.getItem("proco_code");
  var API  = localStorage.getItem("proco_api");
  if (!CODE || !API) { console.log("[PROCO] 개인 코드가 없어 자동 저장을 쉬어요."); return; }

  /* ---------- 브라우저 파일 저장소 읽고 쓰기 ---------- */
  function db() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB);
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function 읽기(d) {
    return new Promise(function (res, rej) {
      var t = d.transaction("files", "readonly").objectStore("files").get(FILE);
      t.onsuccess = function () { res(t.result || null); };
      t.onerror = function () { rej(t.error); };
    });
  }
  function 쓰기(d, model) {
    return new Promise(function (res, rej) {
      var t = d.transaction("files", "readwrite").objectStore("files").put(model, FILE);
      t.onsuccess = function () { res(); };
      t.onerror = function () { rej(t.error); };
    });
  }
  function 모델(내용객체) {
    var now = new Date().toISOString();
    return {
      name: FILE, path: FILE, type: "notebook", format: "json",
      mimetype: null, content: 내용객체, writable: true,
      created: now, last_modified: now, size: JSON.stringify(내용객체).length
    };
  }
  function 해시(s) { // 간단한 변화 감지용
    var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return h + ":" + s.length;
  }

  /* ---------- 서버와 주고받기 ---------- */
  function 서버에서(kind) {
    return fetch(API + "?api=load&code=" + encodeURIComponent(CODE) + "&kind=" + kind)
      .then(function (r) { return r.json(); });
  }
  function 서버로(문자열) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "save", code: CODE, content: 문자열, mode: "auto" })
    }).then(function (r) { return r.json(); });
  }

  /* ---------- 1. 처음 열릴 때 mywork.ipynb 준비 ---------- */
  async function 준비() {
    var d = await db();
    var 있음 = await 읽기(d);
    if (있음) { console.log("[PROCO] mywork.ipynb 가 이미 있어요."); return; }

    // 서버 저장본 먼저, 없으면 템플릿으로
    try {
      var r = await 서버에서("auto");
      if (r && r.ok && r.exists) {
        await 쓰기(d, 모델(JSON.parse(r.content)));
        console.log("[PROCO] 서버 저장본으로 mywork.ipynb 를 만들었어요.");
        return;
      }
    } catch (e) { console.warn("[PROCO] 서버 확인 실패:", e); }

    try {
      var t = await fetch(new URL("../files/template.ipynb", location.href));
      await 쓰기(d, 모델(await t.json()));
      console.log("[PROCO] 템플릿으로 mywork.ipynb 를 만들었어요.");
    } catch (e) { console.warn("[PROCO] 템플릿을 가져오지 못했어요:", e); }
  }

  /* ---------- 2. 10분마다 자동 저장 ---------- */
  async function 저장시도() {
    try {
      var d = await db();
      var m = await 읽기(d);
      if (!m || !m.content) return "파일없음";
      var s = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      var h = 해시(s);
      if (h === 상태.해시) return "변화없음";
      var r = await 서버로(s);
      if (r && r.ok) { 상태.해시 = h; console.log("[PROCO] 자동 저장", r.time); return "저장됨"; }
      console.warn("[PROCO] 저장 실패:", r && r.error); return "실패";
    } catch (e) { console.warn("[PROCO] 저장 중 오류:", e); return "오류"; }
  }
  setInterval(저장시도, 주기);

  // 탭을 벗어날 때도 한 번 (되면 좋고, 안 되면 다음 10분에)
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") 저장시도();
  });

  /* ---------- 3. 기록지에서 온 [불러오기] 신호 ---------- */
  window.addEventListener("message", async function (ev) {
    var m = ev.data;
    if (!m || m.proco !== "load") return;
    try {
      var r = await 서버에서(m.kind === "manual" ? "manual" : "auto");
      if (!r.ok || !r.exists) {
        ev.source && ev.source.postMessage({ proco: "load-result", ok: false, error: r.error || "저장본 없음" }, "*");
        return;
      }
      var d = await db();
      await 쓰기(d, 모델(JSON.parse(r.content)));
      상태.해시 = null;
      ev.source && ev.source.postMessage({ proco: "load-result", ok: true, kind: m.kind, time: r.time }, "*");
    } catch (e) {
      ev.source && ev.source.postMessage({ proco: "load-result", ok: false, error: String(e) }, "*");
    }
  });

  준비();
  console.log("[PROCO] 자동 저장 준비 완료 (10분마다)");
})();
