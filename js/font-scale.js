/* =========================================================
   글자 크기 3단계 (보통 / 크게 / 아주 크게)
   - 눈이 불편한 연령대(50~60대 이상)가 직접 키울 수 있게 한 설정. 기기에 저장됨
   - <html> 에 fs-large / fs-xlarge 클래스를 붙이면 CSS(style.css)가 크기를 키움
   - data-font-scale-btn 속성이 붙은 버튼을 누르면 보통 -> 크게 -> 아주 크게 -> 보통 순환
     (data-short 속성이 있으면 "🔠 크게"처럼 짧게 표시)
   - 깜빡임 없이 바로 적용되도록 <head> 에서 불러옴. 두 앱에 똑같이 들어감
   ========================================================= */
(function () {
  const KEY = "fontScale_v1";
  const STEPS = [
    { k: "normal", label: "보통" },
    { k: "large", label: "크게" },
    { k: "xlarge", label: "아주 크게" },
  ];
  function get() {
    try {
      const v = localStorage.getItem(KEY);
      if (STEPS.some((s) => s.k === v)) return v;
    } catch (e) {}
    return "normal";
  }
  function label(k) {
    return STEPS.find((s) => s.k === k).label;
  }
  function apply(k) {
    const el = document.documentElement;
    STEPS.forEach((s) => el.classList.remove("fs-" + s.k));
    if (k !== "normal") el.classList.add("fs-" + k);
  }
  function refreshButtons() {
    document.querySelectorAll("[data-font-scale-btn]").forEach((b) => {
      const l = label(get());
      b.textContent = b.hasAttribute("data-short") ? "🔠 " + l : "🔠 글자 크기: " + l;
      b.setAttribute("aria-label", "글자 크기 바꾸기. 현재 " + l);
    });
  }
  function cycle() {
    const i = STEPS.findIndex((s) => s.k === get());
    const next = STEPS[(i + 1) % STEPS.length].k;
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {}
    apply(next);
    refreshButtons();
    if (window.fitTextNow) window.fitTextNow();
    return label(next);
  }
  window.cycleFontScale = cycle;
  apply(get());
  document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest ? e.target.closest("[data-font-scale-btn]") : null;
    if (!b) return;
    e.preventDefault();
    const l = cycle();
    if (typeof window.showToast === "function") window.showToast("글자 크기: " + l);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshButtons);
  else refreshButtons();
})();
