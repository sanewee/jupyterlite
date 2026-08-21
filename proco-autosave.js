/**
 * PROCO 자동 저장 v6.2 (불러온 뒤 노트북 자동 재열기)
 *  - v6.2: 저장본을 불러오면 노트북을 자동으로 다시 열어 바로 보이게 함
 *  - v5: 템플릿 편집 모드(?proco-template=1)
 *  - v6: 사용자가 바뀌면(다른 접속 코드·편집 모드 전환) 작업 공간을 비우고
 *        새 사용자의 서버 저장본으로 다시 채움. 제출한 데이터 파일도 자동 복원.
 *  - v3: [제출] 신호로 현재 노트북을 제출본으로 올림
 *  - v4: mywork.ipynb 고정이 아니라, 학생이 실제로 열어 둔 노트북을 따라감.
 *        저장·제출 전에 주피터 문서를 먼저 저장시켜 최신 실행 결과까지 포함.
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
  var 상태 = { 해시: null, contents: null, app: null, 최근: null };

  /* ---------- 개인 코드와 서버 주소 ---------- */
  var q = new URLSearchParams(location.search);
  /* 템플릿 편집 모드 — 교사 대시보드가 ?proco-template=1 로 엽니다.
     학생용 자동 저장은 전부 쉬고, [저장] 신호에만 응답합니다. */
  var TPL = q.get("proco-template") === "1";
  /* 교사 보기 모드 — 교사 대시보드가 ?proco-view=1&code=..&kind=.. 로 엽니다.
     학생의 저장본과 데이터 파일을 그대로 열어 보되, 저장·제출은 하지 않습니다. */
  var VIEW = q.get("proco-view") === "1";
  var VCODE = q.get("code") || "";
  var VKIND = q.get("kind") === "auto" ? "auto" : "manual";
  if (!TPL && q.get("proco")) localStorage.setItem("proco_code", q.get("proco"));
  if (q.get("api"))   localStorage.setItem("proco_api",  q.get("api"));
  var CODE = localStorage.getItem("proco_code");
  var API  = q.get("api") || localStorage.getItem("proco_api");
  if (TPL || VIEW) { if (!API) { console.log("[PROCO] 서버 주소가 없어 쉽니다."); return; } }
  else if (!CODE || !API) { console.log("[PROCO] 개인 코드가 없어 자동 저장을 쉽니다."); return; }

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
  function 파일읽기(경로) {
    return 상태.contents.get(경로 || FILE, { content: true });
  }
  function 파일쓰기(내용객체) {
    return 상태.contents.save(FILE, { type: "notebook", format: "json", content: 내용객체 });
  }

  /* 학생이 실제로 열어 둔 노트북을 따라갑니다.
     화면 맨 앞의 문서가 .ipynb 면 그 파일을, 아니면 마지막으로 봤던 노트북을,
     그것도 없으면 mywork.ipynb 를 씁니다. */
  function 대상경로() {
    try {
      var w = 상태.app.shell.currentWidget;
      if (w && w.context && /\.ipynb$/i.test(w.context.path || "")) 상태.최근 = w.context.path;
    } catch (e) {}
    return 상태.최근 || FILE;
  }
  /* 서버로 보내기 전에 주피터 문서를 먼저 저장시켜, 방금 실행한 출력까지 파일에 담습니다. */
  async function 문서먼저저장() {
    try {
      var w = 상태.app.shell.currentWidget;
      if (w && w.context && w.context.save && /\.ipynb$/i.test(w.context.path || "")
          && w.context.model && w.context.model.dirty) await w.context.save();
    } catch (e) { console.warn("[PROCO] 문서 저장 실패(계속 진행):", e); }
  }

  /* ---------- 작업 공간 소유자 확인 ----------
     공용 PC 대비: 접속 코드가 바뀌었거나 교사 편집 모드로 전환됐으면
     이전 사용자의 파일을 전부 비웁니다. (서버 저장본이 원본이므로 안전) */
  var 식별 = TPL ? "__TPL__" : (VIEW ? "__VIEW__" + VCODE + "__" + VKIND : CODE);
  async function 작업공간확인() {
    var 이전 = localStorage.getItem("proco_ws_owner");
    if (이전 === 식별) return;
    try { await 상태.app.commands.execute("application:close-all"); } catch (e) {}
    try {
      var dir = await 상태.contents.get("", { content: true });
      var items = (dir && dir.content) || [];
      for (var i = 0; i < items.length; i++) {
        try { await 상태.contents.delete(items[i].path); } catch (e) {}
      }
      console.log("[PROCO] 사용자가 바뀌어 작업 공간을 비웠습니다.");
    } catch (e) { console.warn("[PROCO] 작업 공간 정리 실패:", e); }
    try { localStorage.setItem("proco_ws_owner", 식별); } catch (e) {}
  }

  /* ---------- 제출한 데이터 파일 복원 ----------
     서버에 제출된 파일 중 파일 목록에 없는 것을 전부 내려받아 둡니다. */
  async function 데이터복원(누구) {
    var 코드 = 누구 || CODE;
    try {
      var r = await fetch(API + "/api/datalist?code=" + encodeURIComponent(코드))
        .then(function (x) { return x.json(); });
      if (!r || !r.ok || !r.files || !r.files.length) return;
      for (var i = 0; i < r.files.length; i++) {
        var 이름 = r.files[i].name;
        try { await 상태.contents.get(이름); continue; } catch (e) { /* 없음 → 복원 */ }
        try {
          var res = await fetch(API + "/api/nb?code=" + encodeURIComponent(코드)
            + "&kind=data&name=" + encodeURIComponent(이름));
          if (!res.ok) continue;
          var buf = new Uint8Array(await res.arrayBuffer());
          var 글 = "", 토막 = 0x8000;
          for (var j = 0; j < buf.length; j += 토막)
            글 += String.fromCharCode.apply(null, buf.subarray(j, j + 토막));
          await 상태.contents.save(이름, { type: "file", format: "base64", content: btoa(글) });
          console.log("[PROCO] 데이터 파일 복원:", 이름);
        } catch (e) { console.warn("[PROCO] 복원 실패:", 이름, e); }
      }
    } catch (e) { console.warn("[PROCO] 데이터 목록 확인 실패:", e); }
  }

  /* ---------- 교사 보기 모드 ---------- */
  async function 목록새로고침() {
    try { await 상태.app.commands.execute("filebrowser:refresh"); } catch (e) {}
  }
  function 보기알림(단계, ok, 상세) {
    try { parent.postMessage({ proco: "view-status", step: 단계, ok: !!ok, error: 상세 ? String(상세).slice(0, 300) : "" }, "*"); } catch (e) {}
  }
  /* 세션 복원이 열어 둔 옛 문서를 정리하고, 새 파일을 연 뒤 디스크 기준으로 갱신합니다.
     복원된 편집기는 메모리의 옛 내용을 계속 보여 주므로, 닫고 다시 열어야 합니다. */
  /* 열린 문서를 확인창 없이 전부 닫습니다.
     복원된 문서에 '수정됨' 표시가 붙어 있으면 닫을 때 저장 확인창이 떠서
     모든 진행을 막으므로, 표시를 지운 뒤 닫습니다. */
  async function 모두닫기() {
    try {
      var 것들 = 상태.app.shell.widgets ? Array.from(상태.app.shell.widgets("main")) : [];
      for (var i = 0; i < 것들.length; i++) {
        try { if (것들[i].context && 것들[i].context.model) 것들[i].context.model.dirty = false; } catch (e) {}
        /* close-all은 수정됨 표시가 남아 있으면 저장 확인창을 띄워 멈춥니다.
           dispose는 확인 없이 바로 정리되므로 이쪽을 씁니다. */
        try { 것들[i].dispose(); } catch (e) {}
      }
    } catch (e) {}
  }
  /* 혹시라도 "Save your work" 확인창이 뜨면 Discard를 눌러 치웁니다 (보기 모드 전용 안전망) */
  function 확인창치우기() {
    try {
      var 창 = document.querySelector(".jp-Dialog");
      if (!창) return;
      var 글 = 창.textContent || "";
      var 단추들 = 창.querySelectorAll("button");
      if (/before closing/i.test(글)) {                       /* 저장 확인창 → 버리고 닫기 */
        for (var i = 0; i < 단추들.length; i++)
          if (/discard/i.test(단추들[i].textContent || "")) { 단추들[i].click(); return; }
      }
      if (/select kernel/i.test(글)) {                        /* 커널 선택창 → 커널 없이 */
        for (var j = 0; j < 단추들.length; j++)
          if (/no kernel/i.test(단추들[j].textContent || "")) { 단추들[j].click(); return; }
      }
    } catch (e) {}
  }
  async function 새로열기(경로) {
    await 모두닫기();
    await 상태.app.commands.execute("docmanager:open", { path: 경로,
      kernel: { shouldStart: false, canStart: false } });   /* 보기 전용 — 커널 선택창을 띄우지 않음 */
  }

  /* 파일만 덮어써도 화면에 열려 있는 편집기는 메모리의 옛 내용을 계속 보여 줍니다.
     학생이 직접 닫았다 여는 수고를 없애려고, 그 문서만 닫고 다시 엽니다.
     보기 전용인 새로열기()와 달리 커널을 함께 켜서 바로 실행할 수 있게 합니다. */
  async function 다시열기(경로) {
    var 열자 = 경로 || FILE;
    try {
      var 것들 = 상태.app.shell.widgets ? Array.from(상태.app.shell.widgets("main")) : [];
      for (var i = 0; i < 것들.length; i++) {
        var w = 것들[i];
        try {
          if (w.context && w.context.path === 열자) {
            if (w.context.model) w.context.model.dirty = false;   /* 저장 확인창 방지 */
            w.dispose();
          }
        } catch (e) {}
      }
    } catch (e) {}
    await 상태.app.commands.execute("docmanager:open",
      { path: 열자, kernel: { name: 기본커널() } });
    await 목록새로고침();
  }
  /* 커널 이름은 설정값을 따르되, 없으면 파이오다이드 기본값을 씁니다. */
  function 기본커널() {
    try {
      var c = (window.jupyterConfigData || {});
      return c.defaultKernelName || "python";
    } catch (e) { return "python"; }
  }

  async function 보기준비() {
    /* 복원 기능이 옛 학생의 문서를 먼저 열어 둘 수 있어, 시작하자마자 전부 닫습니다 */
    await 모두닫기();
    /* 데이터 파일을 먼저 되살립니다 — 노트북이 잘못돼도 파일은 보이게 */
    try { await 데이터복원(VCODE); } catch (e) { console.warn("[PROCO] 데이터 복원 실패:", e); }
    try {
      var res = await fetch(API + "/api/load?code=" + encodeURIComponent(VCODE) + "&kind=" + VKIND);
      var r = null;
      try { r = await res.json(); }
      catch (e) { 보기알림("응답 해석", false, "HTTP " + res.status); return; }
      if (!r || !r.ok) { 보기알림("저장본 조회", false, (r && r.error) || "응답 없음"); return; }
      if (!r.exists || !r.content) {
        /* 저장본이 없는 학생 — 빈 노트북에 안내 한 줄을 담아 보여 줍니다.
           앞 학생 화면이 남은 것으로 오해하지 않도록 명시적으로 비웁니다. */
        var 빈 = { cells: [{ cell_type: "markdown", metadata: {},
          source: ["**이 학생은 저장된 노트북이 없습니다.**\n\n제출본·자동 저장본이 아직 서버에 올라오지 않았습니다."] }],
          metadata: {}, nbformat: 4, nbformat_minor: 5 };
        try {
          await 상태.contents.save(FILE, { type: "notebook", format: "json", content: 빈 });
          await 새로열기(FILE);
          await 목록새로고침();
        } catch (e) {}
        보기알림("저장본 없음", true, "");
        return;
      }
      var 객체 = r.content;
      for (var k = 0; k < 2 && typeof 객체 === "string"; k++) {   // 겹으로 감싸인 JSON도 풉니다
        try { 객체 = JSON.parse(객체); } catch (e) { break; }
      }
      if (!객체 || typeof 객체 !== "object" || !객체.cells) {
        보기알림("형식 검사", false, "저장본이 노트북 형식이 아님 · 앞부분: " + String(r.content).slice(0, 80)); return;
      }
      try { await 상태.contents.save(FILE, { type: "notebook", format: "json", content: 객체 }); }
      catch (e) { 보기알림("파일 쓰기", false, e); return; }
      try { await 새로열기(FILE); }
      catch (e) { 보기알림("파일 열기", false, e); return; }
      await 목록새로고침();
      보기알림("완료", true, "");
      console.log("[PROCO] 교사 보기 준비 완료:", VCODE, VKIND);
    } catch (e) { 보기알림("준비", false, e); console.warn("[PROCO] 교사 보기 준비 실패:", e); }
  }

  /* ---------- 템플릿 편집 모드 ---------- */
  async function 템플릿준비() {
    try {
      var t = await fetch(API + "/api/template").then(function (r) { return r.json(); });
      await 상태.contents.save("template.ipynb", { type: "notebook", format: "json", content: t });
      await 상태.app.commands.execute("docmanager:open", { path: "template.ipynb" });
      console.log("[PROCO] 템플릿 편집 준비 완료");
    } catch (e) { console.warn("[PROCO] 템플릿 준비 실패:", e); }
  }
  window.addEventListener("message", async function (ev) {
    var m = ev.data;
    if (!TPL || !m || m.proco !== "tpl-pull" || !상태.contents) return;
    try {
      await 문서먼저저장();
      var p = 상태.최근 || "template.ipynb";
      try {
        var w = 상태.app.shell.currentWidget;
        if (w && w.context && /\.ipynb$/i.test(w.context.path || "")) p = w.context.path;
      } catch (e) {}
      var f = await 상태.contents.get(p, { content: true });
      var s = typeof f.content === "string" ? f.content : JSON.stringify(f.content);
      ev.source && ev.source.postMessage({ proco: "tpl-content", ok: true, content: s, path: p }, "*");
    } catch (e) {
      ev.source && ev.source.postMessage({ proco: "tpl-content", ok: false, error: String(e) }, "*");
    }
  });

  /* ---------- 1. 처음 준비 ---------- */
  async function 준비() {
    try {
      await 파일읽기();
      console.log("[PROCO] mywork.ipynb 가 이미 있습니다. 어느 저장본을 쓸지는 학생이 첫 화면에서 고릅니다.");
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
      await 문서먼저저장();
      var 경로 = 대상경로();
      var m = await 파일읽기(경로);
      var s = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      var h = 해시(s);
      if (h === 상태.해시) return "변화없음";
      var r = await 서버로(s);
      if (r && r.ok) { 상태.해시 = h; console.log("[PROCO] 자동 저장 (" + 경로 + ")", r.time); return "저장됨"; }
      console.warn("[PROCO] 저장 실패:", r && r.error); return "실패";
    } catch (e) { console.warn("[PROCO] 저장 중 오류:", e); return "오류"; }
  }

  /* ---------- 3. 기록지의 [불러오기]·[제출] 신호 (학생 모드 전용) ---------- */
  window.addEventListener("message", async function (ev) {
    var m = ev.data;
    if (TPL || !m || !상태.contents) return;

    // [제출] — 학생이 열어 둔 노트북을 먼저 저장시킨 뒤 그대로 서버에 올립니다.
    if (m.proco === "push") {
      try {
        await 문서먼저저장();
        var 경로2 = 대상경로();
        var f = await 파일읽기(경로2);
        var s2 = typeof f.content === "string" ? f.content : JSON.stringify(f.content);
        var r2 = await 서버로(s2, "manual");
        상태.해시 = null;   // 다음 자동 저장 때 다시 비교하도록
        console.log("[PROCO] 제출 (" + 경로2 + ")", r2 && r2.time);
        ev.source && ev.source.postMessage(
          { proco: "push-result", ok: !!(r2 && r2.ok), time: r2 && r2.time, path: 경로2, error: r2 && r2.error }, "*");
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
      /* 불러온 내용이 화면에 바로 보이도록 노트북을 다시 엽니다.
         실패해도 파일은 이미 바뀌었으므로, 학생에게 직접 열라고 안내합니다. */
      var 열림 = true;
      try { await 다시열기(FILE); }
      catch (e) { 열림 = false; console.warn("[PROCO] 다시 열기 실패:", e); }
      ev.source && ev.source.postMessage(
        { proco: "load-result", ok: true, kind: m.kind, time: r.time, 다시열림: 열림 }, "*");
    } catch (e) {
      ev.source && ev.source.postMessage({ proco: "load-result", ok: false, error: String(e) }, "*");
    }
  });

  /* ---------- 앱이 켜질 때까지 기다렸다가 시작 ---------- */
  var 기다림 = setInterval(function () {
    var app = window.jupyterapp || window.jupyterlab;
    if (!app || !app.serviceManager) return;
    clearInterval(기다림);
    app.started.then(async function () {
      상태.app = app;
      상태.contents = app.serviceManager.contents;
      /* 세션 복원이 옛 문서를 늦게 되살리므로, 복원이 끝나기를 기다렸다가 정리합니다 */
      try { await app.restored; } catch (e) {}
      await 작업공간확인();
      if (TPL)  { 템플릿준비(); return; }         // 편집 모드는 자동 저장을 돌리지 않습니다
      if (VIEW) { setInterval(확인창치우기, 1500); 보기준비(); return; }   // 교사 보기도 저장하지 않습니다
      await 준비();
      await 데이터복원();
      목록새로고침();
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
