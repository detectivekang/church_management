/* =========================================================
   [신규] 안드로이드 앱(WebView) 상태표시줄/카메라 영역 여백 보정
   - 브라우저는 env(safe-area-inset-*)로 카메라/상태표시줄/하단 바 영역을 알려주지만,
     일부 안드로이드 앱 WebView는 화면이 시스템 영역 아래까지 그려지는데도 이 값을
     0으로 돌려줌 -> 헤더가 상태표시줄/카메라와 겹침
   - 그래서 "앱 WebView이면서 env() 값이 0"일 때만 html에 wv-fallback 클래스를 붙여
     style.css의 기본 여백(--safe-top / --safe-bottom)을 쓰게 함
   - 일반 브라우저나 env()가 정상 동작하는 환경에서는 아무 일도 하지 않음
   - 안드로이드 앱 쪽에서 WindowInsets 패딩을 직접 적용한 경우에는 이 보정이
     중복 여백이 되므로, 그때는 이 파일의 <script> 태그를 지우면 됨
   ========================================================= */
(function () {
  try {
    const isAndroidWebView = /; wv\)/.test(navigator.userAgent || "");
    if (!isAndroidWebView) return;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);";
    (document.body || document.documentElement).appendChild(probe);
    const envTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    if (envTop === 0) document.documentElement.classList.add("wv-fallback");
  } catch (e) {
    /* 보정에 실패해도 앱 동작에는 영향 없음 */
  }
})();
