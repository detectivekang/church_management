/* =========================================================
   [신규] 숫자 자동 맞춤 (큰 숫자가 카드 밖으로 잘리거나 줄바꿈되지 않게)
   - 금액처럼 자릿수가 많아지는 숫자는 한 줄로 두고, 들어갈 자리에 맞게 글자
     크기를 자동으로 줄임 (예: 901,000,000원). 숫자가 짧으면 원래 크기 그대로.
   - 화면 폭이 바뀌거나(가로/세로 회전), 값이 바뀌거나, 숨겨졌던 화면이 보이게
     되면 자동으로 다시 맞춤
   - 대상: 아래 SELECTOR 의 요소 + data-fit-text 속성을 붙인 요소
     (data-fit-min="10" 처럼 줄일 수 있는 최소 글자 크기(px)를 지정할 수도 있음)
   - 이 파일은 교회출석부와 교회관리시스템에 똑같이 들어감
   ========================================================= */
(function () {
  const SELECTOR =
    ".home-stat-value, .home-chart-value, .summary-card .num, [data-fit-text]";
  let observer = null;
  let scheduled = false;

  function fitOne(el) {
    el.style.fontSize = "";
    el.style.whiteSpace = "nowrap";
    const parent = el.parentElement;
    if (!parent || !parent.clientWidth) return; /* 숨겨진 화면은 보일 때 다시 맞춤 */
    const cs = getComputedStyle(parent);
    const avail =
      parent.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    if (avail <= 0) return;
    const max = parseFloat(getComputedStyle(el).fontSize) || 16;
    const minAttr = parseFloat(el.getAttribute("data-fit-min"));
    const min = Math.min(max, Math.max(9, isNaN(minAttr) ? max * 0.55 : minAttr));
    let size = max;
    while (size > min && el.scrollWidth > avail + 1) {
      size = Math.max(min, size - 0.5);
      el.style.fontSize = size + "px";
    }
  }

  function observe() {
    if (!observer) observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
  }

  function run() {
    scheduled = false;
    /* 글자 크기를 바꾸는 동안에는 관찰을 멈춰서 스스로 다시 실행되는 일을 막음 */
    if (observer) observer.disconnect();
    document.querySelectorAll(SELECTOR).forEach(fitOne);
    observe();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  }

  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  window.fitTextNow = schedule;
  observe();
  schedule();
})();
