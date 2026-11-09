/* =========================================================
   교회출석부 <-> 교회관리시스템 단일 로그인(SSO)
   - 두 앱은 같은 Supabase 계정을 쓰지만 주소(도메인)가 달라서 로그인 상태가
     자동으로 공유되지 않음. 그래서 한쪽에서 로그인한 상태로 다른 쪽 링크를
     누르면 아래 순서로 상대 앱에도 로그인된 채로 열어줌.
       1) (보내는 쪽) sso-handoff Edge Function 에서 "일회용 로그인 토큰"을 받아
          상대 앱 주소 뒤에 #sso=토큰 을 붙여 이동
       2) (받는 쪽) 주소의 #sso= 를 읽어 즉시 주소창에서 지우고, verifyOtp 로
          자기 도메인에서 새 세션을 만듦 -> 기존 로그인 처리가 자동으로 이어져
          해당 계정의 메인 화면이 열림
   - 로그인 정보(액세스/리프레시 토큰) 자체를 주소에 싣지 않음. 토큰은 1회용.
   - 로그인 안 된 상태이거나 토큰을 못 받으면 일반 링크처럼 이동(상대 앱 로그인 화면)
   - 이 파일은 두 앱에 똑같이 들어감. js/supabase-init.js 다음에 불러와야 함
   - 사용법: 상대 앱으로 가는 링크에 data-sso-link 속성을 붙이면 됨
       <a href="https://상대앱주소/" data-sso-link>...</a>
   ========================================================= */
(function () {
  /* 토큰을 실어 보내도 되는 주소(origin) - 이 둘 외에는 절대 토큰을 붙이지 않음 */
  const SSO_ALLOWED_ORIGINS = [
    "https://church-attendance-six.vercel.app",
    "https://detectivekang.github.io",
  ];
  const TOKEN_TIMEOUT_MS = 6000;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

  /* ---------- 받는 쪽: #sso=토큰 으로 열렸을 때 ---------- */
  function showOverlay() {
    const el = document.createElement("div");
    el.id = "ssoOverlay";
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;" +
      "justify-content:center;background:#fff;color:#4b5566;font-size:15px;" +
      "font-family:-apple-system,'Noto Sans KR',sans-serif;";
    el.textContent = "로그인 확인 중...";
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  async function consumeSsoHash() {
    const m = /[#&]sso=([^&]+)/.exec(location.hash || "");
    if (!m) return;
    let token = "";
    try {
      token = decodeURIComponent(m[1]);
    } catch (e) {}
    /* 토큰이 주소창/방문 기록에 남지 않도록 가장 먼저 지움 */
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {}
    if (!TOKEN_PATTERN.test(token)) return;

    const overlay = showOverlay();
    try {
      let { error } = await sb.auth.verifyOtp({ token_hash: token, type: "magiclink" });
      /* 최신 supabase 버전은 매직링크 토큰도 type "email" 로 받으므로 한 번 더 시도 */
      if (error) ({ error } = await sb.auth.verifyOtp({ token_hash: token, type: "email" }));
      if (error) console.warn("SSO 로그인에 실패했습니다:", error.message);
    } catch (e) {
      console.warn("SSO 로그인 중 오류:", e);
    } finally {
      overlay.remove();
    }
  }

  /* ---------- 보내는 쪽: 상대 앱 링크를 눌렀을 때 ---------- */
  async function fetchSsoToken() {
    try {
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS));
      const res = await Promise.race([sb.functions.invoke("sso-handoff", { method: "POST" }), timeout]);
      if (res && !res.error && res.data && res.data.token_hash) return String(res.data.token_hash);
    } catch (e) {}
    return "";
  }

  let navigating = false;
  async function ssoNavigate(url, linkEl) {
    if (navigating) return;
    navigating = true;
    if (linkEl) linkEl.classList.add("sso-loading");
    let target = url;
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin && SSO_ALLOWED_ORIGINS.includes(u.origin)) {
        const token = await fetchSsoToken();
        if (token) target = u.origin + u.pathname + u.search + "#sso=" + encodeURIComponent(token);
      }
    } catch (e) {}
    location.href = target;
  }
  window.ssoNavigate = ssoNavigate;

  document.addEventListener("click", (e) => {
    const link = e.target && e.target.closest ? e.target.closest("a[data-sso-link]") : null;
    if (!link || e.defaultPrevented) return;
    /* 새 탭/창으로 여는 동작(Ctrl/Cmd/Shift 클릭, 가운데 버튼)은 브라우저에 맡김 */
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    ssoNavigate(link.href, link);
  });

  /* 뒤로가기로 이 페이지에 돌아왔을 때 "이동 중" 상태가 남아있지 않게 초기화 */
  window.addEventListener("pageshow", () => {
    navigating = false;
    document.querySelectorAll("a[data-sso-link].sso-loading").forEach((el) => el.classList.remove("sso-loading"));
  });

  consumeSsoHash();
})();
