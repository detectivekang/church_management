/* =========================================================
   홈 화면 - 등록 현황을 한눈에 보여주는 대시보드.
   추가 서버 호출 없이, 이미 로그인 시 불러온 parishioners
   캐시만으로 계산합니다 (교회 하나당 인원이 수천 명을
   넘기 전까지는 이 방식이 더 빠르고 단순합니다).
   ========================================================= */

function homeActiveParishioners() {
  return parishioners.filter((p) => (p.memberStatus || "active") === "active");
}

function homeRegDate(p) {
  return p.registrationDate || "";
}

function homeIsInCurrentMonth(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return dateStr.startsWith(ym);
}

let notices = [];

function renderHome() {
  renderHomeStats();
  renderHomeMonthlyChart();
  renderHomeBirthdays();
  renderHomeNewFamily();
  renderHomeDeptTable();
  loadAndRenderNotices();
}

/* ---------------------------------------------------------
   상단 통계 카드
   --------------------------------------------------------- */
function renderHomeStats() {
  const total = parishioners.length;
  const active = homeActiveParishioners().length;
  const newThisMonth = parishioners.filter((p) => homeIsInCurrentMonth(homeRegDate(p))).length;
  document.getElementById("homeStatTotal").textContent = total.toLocaleString("ko-KR");
  document.getElementById("homeStatActive").textContent = active.toLocaleString("ko-KR");
  document.getElementById("homeStatNew").textContent = newThisMonth.toLocaleString("ko-KR");
}

/* ---------------------------------------------------------
   월별 등록자 현황 (최근 8개월, 등록일 기준 막대그래프)
   --------------------------------------------------------- */
function renderHomeMonthlyChart() {
  const wrap = document.getElementById("homeMonthlyChart");
  const now = new Date();
  const months = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${d.getMonth() + 1}월`,
    });
  }
  const counts = months.map((m) => parishioners.filter((p) => homeRegDate(p).startsWith(m.ym)).length);
  const max = Math.max(1, ...counts);

  if (counts.every((c) => c === 0)) {
    wrap.innerHTML = '<div class="empty">등록일 정보가 있는 교인이 없습니다.</div>';
    return;
  }

  wrap.innerHTML = `
    <div class="home-chart">
      ${months
        .map((m, i) => {
          const h = counts[i] > 0 ? Math.max(Math.round((counts[i] / max) * 100), 6) : 0;
          return `
            <div class="home-chart-col">
              <div class="home-chart-value">${counts[i] || ""}</div>
              <div class="home-chart-bar-track">
                <div class="home-chart-bar" style="height:${h}%"></div>
              </div>
              <div class="home-chart-label">${m.label}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

/* ---------------------------------------------------------
   이번 달 생일자
   --------------------------------------------------------- */
function renderHomeBirthdays() {
  const wrap = document.getElementById("homeBirthdayList");
  const thisMonth = String(new Date().getMonth() + 1).padStart(2, "0");
  const list = parishioners
    .filter((p) => (p.memberStatus || "active") === "active" && p.birthDate && p.birthDate.split("-")[1] === thisMonth)
    .sort((a, b) => Number(a.birthDate.split("-")[2]) - Number(b.birthDate.split("-")[2]));

  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">이번 달 생일인 교인이 없습니다.</div>';
    return;
  }

  wrap.innerHTML = list
    .map((p) => {
      const day = Number(p.birthDate.split("-")[2]);
      const thumb = p.photoUrl
        ? `<div class="home-newfamily-avatar"><img src="${p.photoUrl}" alt="" /></div>`
        : `<div class="home-newfamily-avatar home-newfamily-avatar-empty">${escapeHtml((p.name || "").slice(0, 1))}</div>`;
      return `
        <div class="home-newfamily-card" data-id="${p.id}" data-act="home-open-parishioner">
          ${thumb}
          <div class="home-newfamily-name">${escapeHtml(p.name)}</div>
          <div class="home-newfamily-sub">${day}일</div>
        </div>
      `;
    })
    .join("");
  wrap.querySelectorAll('[data-act="home-open-parishioner"]').forEach((el) => {
    el.addEventListener("click", () => {
      switchMainPanel("parishioners");
      openParishionerModal(el.dataset.id);
    });
  });
}

/* ---------------------------------------------------------
   새가족 소개 (등록일이 최근인 순서로 상위 8명)
   --------------------------------------------------------- */
function renderHomeNewFamily() {
  const wrap = document.getElementById("homeNewFamilyList");
  const list = parishioners
    .filter((p) => homeRegDate(p))
    .sort((a, b) => homeRegDate(b).localeCompare(homeRegDate(a)))
    .slice(0, 8);
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">등록일이 입력된 교인이 아직 없습니다. 교인 등록 시 "등록일"을 입력하면 여기에 표시됩니다.</div>';
    return;
  }
  wrap.innerHTML = list
    .map((p) => {
      const age = calcAge(p.birthDate);
      const thumb = p.photoUrl
        ? `<div class="home-newfamily-avatar"><img src="${p.photoUrl}" alt="" /></div>`
        : `<div class="home-newfamily-avatar home-newfamily-avatar-empty">${escapeHtml((p.name || "").slice(0, 1))}</div>`;
      return `
        <div class="home-newfamily-card" data-id="${p.id}" data-act="home-open-parishioner">
          ${thumb}
          <div class="home-newfamily-name">${escapeHtml(p.name)}</div>
          <div class="home-newfamily-sub">${age ? age + "세" : ""}</div>
        </div>
      `;
    })
    .join("");
  wrap.querySelectorAll('[data-act="home-open-parishioner"]').forEach((el) => {
    el.addEventListener("click", () => {
      switchMainPanel("parishioners");
      openParishionerModal(el.dataset.id);
    });
  });
}

/* ---------------------------------------------------------
   부서별 성도 현황 (재적 교인만 집계)
   --------------------------------------------------------- */
function renderHomeDeptTable() {
  const wrap = document.getElementById("homeDeptTable");
  const active = homeActiveParishioners();
  if (active.length === 0) {
    wrap.innerHTML = '<div class="empty">등록된 재적 교인이 없습니다.</div>';
    return;
  }
  const byDept = {};
  active.forEach((p) => {
    const dept = p.department && p.department.trim() ? p.department.trim() : "미배정";
    if (!byDept[dept]) byDept[dept] = { male: 0, female: 0, total: 0 };
    byDept[dept].total += 1;
    if (p.gender === "M") byDept[dept].male += 1;
    else if (p.gender === "F") byDept[dept].female += 1;
  });
  const rows = Object.entries(byDept)
    .map(([dept, c]) => ({ dept, ...c }))
    .sort((a, b) => b.total - a.total);
  const grandTotal = active.length;

  wrap.innerHTML = `
    <table class="home-dept-table-el">
      <thead>
        <tr><th>부서</th><th>남</th><th>여</th><th>합계</th><th>비율</th></tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => {
            const pct = grandTotal ? Math.round((r.total / grandTotal) * 100) : 0;
            return `
              <tr>
                <td>${escapeHtml(r.dept)}</td>
                <td>${r.male}</td>
                <td>${r.female}</td>
                <td>${r.total}</td>
                <td>
                  <div class="home-dept-bar-row">
                    <div class="home-dept-bar-track">
                      <div class="home-dept-bar" style="width:${pct}%"></div>
                    </div>
                    <span class="home-dept-pct">${pct}%</span>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

/* ---------------------------------------------------------
   공지사항 - notices 테이블은 교회 출석부 앱과 공유합니다.
   여기서 올린 공지가 출석부 쪽 홈화면에도 그대로 보입니다.
   --------------------------------------------------------- */
async function loadAndRenderNotices() {
  const wrap = document.getElementById("homeNoticeList");
  wrap.innerHTML = '<div class="empty">불러오는 중...</div>';
  try {
    const snap = await churchCol("notices").orderBy("createdAt", "desc").limit(5).get();
    notices = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    wrap.innerHTML = '<div class="empty">공지사항을 불러오지 못했습니다.</div>';
    return;
  }
  renderHomeNotices();
}

function renderHomeNotices() {
  const wrap = document.getElementById("homeNoticeList");
  if (notices.length === 0) {
    wrap.innerHTML = '<div class="empty">등록된 공지사항이 없습니다.</div>';
    return;
  }
  wrap.innerHTML = notices
    .map(
      (n) => `
        <div class="home-notice-row">
          <div class="home-notice-dot" aria-hidden="true"></div>
          <div class="home-notice-content">${escapeHtml(n.content || "")}</div>
          <button type="button" class="home-notice-delete" data-id="${n.id}" data-act="delete-notice" aria-label="삭제">✕</button>
        </div>
      `,
    )
    .join("");
  wrap.querySelectorAll('[data-act="delete-notice"]').forEach((btn) => {
    btn.addEventListener("click", () => deleteNotice(btn.dataset.id));
  });
}

async function addNotice() {
  const input = document.getElementById("homeNoticeInput");
  const content = input.value.trim();
  if (!content) return;
  const btn = document.getElementById("homeNoticeAddBtn");
  btn.disabled = true;
  try {
    await churchCol("notices").add({
      content,
      popup: false,
      createdBy: (currentUser && currentUser.email) || "",
    });
    input.value = "";
    await loadAndRenderNotices();
  } catch (e) {
    alertDialog("공지 등록 중 오류가 발생했습니다: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

async function deleteNotice(id) {
  const ok = await confirmDialog("이 공지를 삭제할까요?");
  if (!ok) return;
  try {
    await churchCol("notices").doc(id).delete();
    await loadAndRenderNotices();
  } catch (e) {
    alertDialog("삭제 중 오류가 발생했습니다: " + e.message);
  }
}

document.getElementById("homeNoticeAddBtn").addEventListener("click", addNotice);
document.getElementById("homeNoticeInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addNotice();
});
