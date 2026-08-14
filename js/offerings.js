/* =========================================================
   헌금(기부금) 관리
   ⚠️ 이 화면에서 출력하는 "헌금확인서"는 참고용 서식입니다.
   국세청에 신고하는 정식 기부금영수증은 소득세법 시행규칙이
   정한 서식/절차(지정기부금단체 등록, 홈택스 발급명세서 제출
   등)를 따라야 하며, 이 부분은 반드시 교회 회계 담당자·세무사와
   함께 최신 서식을 확인한 뒤 실제로 사용해주세요.
   ========================================================= */

const OFFERING_TYPES = ["십일조", "주일헌금", "감사헌금", "선교헌금", "건축헌금", "절기헌금", "작정헌금", "기타"];

document.getElementById("offeringType").innerHTML = OFFERING_TYPES.map(
  (t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`,
).join("");
document.getElementById("offeringDate").value = todayStr();
renderOfferingYearSelect();

let offeringSearchKeyword = "";

async function loadOfferings() {
  const snap = await churchCol("offerings").get();
  offerings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function offeringsForYear(year) {
  const prefix = String(year);
  return offerings.filter((o) => (o.offeringDate || "").startsWith(prefix));
}

function fmtWon(n) {
  return (n || 0).toLocaleString("ko-KR") + "원";
}

function parishionerName(id) {
  const p = parishioners.find((x) => x.id === id);
  return p ? p.name : "(무기명)";
}

/* ---------------------------------------------------------
   등록 폼
   --------------------------------------------------------- */
function renderOfferingPersonPicker() {
  const wrap = document.getElementById("offeringPersonResults");
  const kw = offeringPersonSearchKeyword.trim();
  if (!kw) {
    wrap.innerHTML = "";
    return;
  }
  const matches = sortByName(parishioners.filter((p) => p.name.includes(kw))).slice(0, 8);
  if (matches.length === 0) {
    wrap.innerHTML = '<div class="empty" style="padding:8px 0">일치하는 교인이 없습니다.</div>';
    return;
  }
  wrap.innerHTML = matches
    .map(
      (p) => `<div class="picker-row" data-id="${p.id}">${escapeHtml(p.name)} <span class="sms-recipient-sub">${escapeHtml(p.department || "")}</span></div>`,
    )
    .join("");
  wrap.querySelectorAll(".picker-row").forEach((row) => {
    row.addEventListener("click", () => {
      offeringPickedParishionerId = row.dataset.id;
      document.getElementById("offeringPersonSearch").value = parishionerName(row.dataset.id);
      wrap.innerHTML = "";
    });
  });
}

document.getElementById("offeringPersonSearch").addEventListener("input", (e) => {
  offeringPickedParishionerId = null;
  offeringPersonSearchKeyword = e.target.value;
  renderOfferingPersonPicker();
});

document.getElementById("offeringAnonymousCheck").addEventListener("change", (e) => {
  const disabled = e.target.checked;
  document.getElementById("offeringPersonSearch").disabled = disabled;
  if (disabled) {
    document.getElementById("offeringPersonSearch").value = "";
    offeringPickedParishionerId = null;
    document.getElementById("offeringPersonResults").innerHTML = "";
  }
});

document.getElementById("addOfferingBtn").addEventListener("click", async () => {
  const isAnonymous = document.getElementById("offeringAnonymousCheck").checked;
  if (!isAnonymous && !offeringPickedParishionerId) {
    await alertDialog("헌금자를 검색해서 선택하거나, 무기명 헌금에 체크해주세요.");
    return;
  }
  const dateEl = document.getElementById("offeringDate");
  const amountEl = document.getElementById("offeringAmount");
  const amount = Number(amountEl.value);
  if (!dateEl.value) {
    await alertDialog("날짜를 입력해주세요.");
    return;
  }
  if (!amount || amount <= 0) {
    await alertDialog("금액을 올바르게 입력해주세요.");
    amountEl.focus();
    return;
  }

  const payload = {
    parishionerId: isAnonymous ? null : offeringPickedParishionerId,
    offeringDate: dateEl.value,
    offeringType: document.getElementById("offeringType").value,
    amount,
    memo: document.getElementById("offeringMemo").value.trim(),
    createdAt: Date.now(),
    createdBy: (currentUser && currentUser.email) || "",
  };

  const btn = document.getElementById("addOfferingBtn");
  btn.disabled = true;
  try {
    await churchCol("offerings").add(payload);
    await loadOfferings();
    renderOfferingList();
    renderOfferingSummary();
    // 입력폼 초기화 (날짜/항목은 연속 입력 편의상 유지)
    amountEl.value = "";
    document.getElementById("offeringMemo").value = "";
    document.getElementById("offeringPersonSearch").value = "";
    document.getElementById("offeringAnonymousCheck").checked = false;
    document.getElementById("offeringPersonSearch").disabled = false;
    offeringPickedParishionerId = null;
    showToast("등록되었습니다.");
  } catch (e) {
    await alertDialog("저장 중 오류가 발생했습니다: " + (e.message || e));
  } finally {
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------
   최근 기록 목록
   --------------------------------------------------------- */
function filteredOfferingList() {
  const kw = offeringSearchKeyword.trim();
  const list = [...offeringsForYear(offeringsYear)].sort((a, b) =>
    (b.offeringDate || "").localeCompare(a.offeringDate || ""),
  );
  if (!kw) return list;
  return list.filter((o) => {
    const haystack = [parishionerName(o.parishionerId), o.offeringType, o.memo].filter(Boolean).join(" ");
    return haystack.includes(kw);
  });
}

function renderOfferingList() {
  const wrap = document.getElementById("offeringList");
  const totalCount = offeringsForYear(offeringsYear).length;
  const list = filteredOfferingList();
  if (totalCount === 0) {
    wrap.innerHTML = '<div class="empty">등록된 헌금 기록이 없습니다.</div>';
    return;
  }
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }
  wrap.innerHTML = list
    .slice(0, 50)
    .map(
      (o) => `
      <div class="list-card" style="cursor: default">
        <div class="list-card-main">
          <div class="list-card-title">${escapeHtml(o.offeringDate)} · ${escapeHtml(parishionerName(o.parishionerId))}</div>
          <div class="list-card-sub">${escapeHtml(o.offeringType)} · ${fmtWon(o.amount)}${o.memo ? " · " + escapeHtml(o.memo) : ""}</div>
        </div>
        <button type="button" class="visit-delete" data-id="${o.id}" data-act="delete-offering">삭제</button>
      </div>
    `,
    )
    .join("");
  wrap.querySelectorAll('[data-act="delete-offering"]').forEach((btn) => {
    btn.addEventListener("click", () => deleteOffering(btn.dataset.id));
  });
  if (list.length > 50) {
    wrap.innerHTML += `<div class="hint-text">최근 50건만 표시됩니다. 전체 통계는 아래 "개인별 연간 합계"를 확인하세요.</div>`;
  }
}

document.getElementById("offeringSearchInput").addEventListener("input", (e) => {
  offeringSearchKeyword = e.target.value;
  renderOfferingList();
});

async function deleteOffering(id) {
  const ok = await confirmDialog("이 헌금 기록을 삭제하시겠습니까?", "삭제", "취소");
  if (!ok) return;
  try {
    await churchCol("offerings").doc(id).delete();
    await loadOfferings();
    renderOfferingList();
    renderOfferingSummary();
    showToast("삭제되었습니다.");
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* ---------------------------------------------------------
   연도 선택 / 개인별 연간 합계
   --------------------------------------------------------- */
function renderOfferingYearSelect() {
  const sel = document.getElementById("offeringYearSelect");
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear; y >= thisYear - 4; y--) years.push(y);
  sel.innerHTML = years.map((y) => `<option value="${y}" ${y === offeringsYear ? "selected" : ""}>${y}년</option>`).join("");
}
document.getElementById("offeringYearSelect").addEventListener("change", (e) => {
  offeringsYear = Number(e.target.value);
  renderOfferingList();
  renderOfferingSummary();
});

function renderOfferingSummary() {
  const wrap = document.getElementById("offeringSummary");
  const list = offeringsForYear(offeringsYear).filter((o) => o.parishionerId);
  const byPerson = {};
  list.forEach((o) => {
    if (!byPerson[o.parishionerId]) byPerson[o.parishionerId] = 0;
    byPerson[o.parishionerId] += Number(o.amount) || 0;
  });
  const rows = Object.entries(byPerson)
    .map(([pid, total]) => ({ pid, name: parishionerName(pid), total }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  if (rows.length === 0) {
    wrap.innerHTML = '<div class="empty">해당 연도 기록이 없습니다.</div>';
    return;
  }
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
  wrap.innerHTML = `
    <div class="hint-text" style="margin-bottom:6px">전체 합계: ${fmtWon(grandTotal)} (무기명 헌금 제외)</div>
    ${rows
      .map(
        (r) => `
      <div class="list-card" style="cursor: default">
        <div class="list-card-main">
          <div class="list-card-title">${escapeHtml(r.name)}</div>
          <div class="list-card-sub">${offeringsYear}년 합계 ${fmtWon(r.total)}</div>
        </div>
        <button type="button" class="btn ghost small" data-id="${r.pid}" data-act="print-statement">확인서 출력</button>
      </div>
    `,
      )
      .join("")}
  `;
  wrap.querySelectorAll('[data-act="print-statement"]').forEach((btn) => {
    btn.addEventListener("click", () => printOfferingStatement(btn.dataset.id));
  });
}

/* ---------------------------------------------------------
   헌금확인서 출력 (참고용 - 상단 주석 참고)
   --------------------------------------------------------- */
function printOfferingStatement(parishionerId) {
  const person = parishioners.find((p) => p.id === parishionerId);
  const list = offeringsForYear(offeringsYear)
    .filter((o) => o.parishionerId === parishionerId)
    .sort((a, b) => (a.offeringDate || "").localeCompare(b.offeringDate || ""));
  const total = list.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  const churchName = (currentChurchData && currentChurchData.name) || "";

  const win = window.open("", "_blank");
  win.document.write(`
    <!doctype html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8" />
      <title>헌금확인서 - ${escapeHtml(person ? person.name : "")}</title>
      <style>
        body { font-family: "Noto Sans KR", sans-serif; padding: 40px; color: #1b2a41; }
        h1 { font-size: 20px; text-align: center; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #ccc; padding: 8px 10px; font-size: 13px; text-align: left; }
        th { background: #f2f2f2; }
        .meta { font-size: 13.5px; margin-bottom: 4px; }
        .total { text-align: right; font-weight: 700; margin-top: 12px; }
        .notice { margin-top: 30px; font-size: 11.5px; color: #888; line-height: 1.6; border-top: 1px solid #ccc; padding-top: 10px; }
      </style>
    </head>
    <body>
      <h1>${offeringsYear}년 헌금확인서</h1>
      <div class="meta">교회명: ${escapeHtml(churchName)}</div>
      <div class="meta">성명: ${escapeHtml(person ? person.name : "")}</div>
      <div class="meta">발급일: ${todayStr()}</div>
      <table>
        <thead><tr><th>날짜</th><th>항목</th><th>금액</th></tr></thead>
        <tbody>
          ${list.map((o) => `<tr><td>${escapeHtml(o.offeringDate)}</td><td>${escapeHtml(o.offeringType)}</td><td>${fmtWon(o.amount)}</td></tr>`).join("")}
        </tbody>
      </table>
      <div class="total">합계: ${fmtWon(total)}</div>
      <div class="notice">
        ※ 이 확인서는 내부 참고용 서식입니다. 국세청에 정식으로 신고하는
        기부금영수증은 소득세법 시행규칙이 정한 서식과 절차(지정기부금단체
        등록, 홈택스 발급명세서 제출 등)를 따라야 하므로, 실제 발급 전
        반드시 교회 회계 담당자·세무사와 함께 최신 서식을 확인해주세요.
      </div>
      <script>window.onload = () => window.print();<\/script>
    </body>
    </html>
  `);
  win.document.close();
}
