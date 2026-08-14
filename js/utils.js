/* =========================================================
   유틸 함수 (church_attendance의 js/utils.js에서 이 화면에
   필요한 것만 그대로 가져옴 - 로직을 다시 만들지 않고 재사용)
   ========================================================= */
function escapeHtml(s) {
  return (s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}
function roleName(r) {
  return (
    {
      superadmin: "관리자",
      admin: "운영자",
      operator: "그룹장",
      leader: "팀장",
      none: "권한 없음",
    }[r] || ""
  );
}
function sortByName(arr, nameFn) {
  const getName = nameFn || ((x) => (x && x.name) || "");
  return [...arr].sort((a, b) => getName(a).localeCompare(getName(b), "ko"));
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* =========================================================
   자체 확인/알림 모달 (native confirm()/alert() 대체) - 카카오톡 등
   일부 인앱 브라우저에서 native 창이 무시되는 문제 회피
   ========================================================= */
function confirmDialog(message, okText, cancelText) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:320px;">
        <div class="modal-sub" style="white-space:pre-line;font-size:13.5px;color:var(--ink);margin-bottom:16px;">${escapeHtml(message)}</div>
        <div class="modal-actions">
          <button type="button" class="btn ghost small" data-act="cancel">${escapeHtml(cancelText || "취소")}</button>
          <button type="button" class="btn small" data-act="ok">${escapeHtml(okText || "확인")}</button>
        </div>
      </div>
    `;
    function close(result) {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve(result);
    }
    function onKeydown(e) {
      if (e.key === "Escape") close(false);
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => close(false));
    overlay.querySelector('[data-act="ok"]').addEventListener("click", () => close(true));
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(overlay);
  });
}
function alertDialog(message, okText) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:320px;">
        <div class="modal-sub" style="white-space:pre-line;font-size:13.5px;color:var(--ink);margin-bottom:16px;">${escapeHtml(message)}</div>
        <div class="modal-actions">
          <button type="button" class="btn small" data-act="ok">${escapeHtml(okText || "확인")}</button>
        </div>
      </div>
    `;
    function close() {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve();
    }
    function onKeydown(e) {
      if (e.key === "Escape" || e.key === "Enter") close();
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('[data-act="ok"]').addEventListener("click", close);
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(overlay);
  });
}
function showToast(message, duration) {
  let el = document.getElementById("appToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "appToast";
    el.className = "app-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove("show");
  }, duration || 1800);
}

/* church_attendance의 translateAuthError를 그대로 가져옴 */
function translateAuthError(e) {
  const msg = (e && e.message) || "";
  if (/invalid login credentials/i.test(msg)) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (/email not confirmed/i.test(msg)) return "이메일 인증이 필요합니다.";
  if (/rate limit/i.test(msg)) return "잠시 후 다시 시도해주세요.";
  return msg || "로그인 중 오류가 발생했습니다.";
}
function markRequired(els) {
  let ok = true;
  els.forEach((el) => {
    if (!el.value || !el.value.trim()) {
      el.classList.add("field-error");
      ok = false;
    } else {
      el.classList.remove("field-error");
    }
  });
  return ok;
}
