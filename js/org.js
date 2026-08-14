/* =========================================================
   조직관리 - 성가대-베이스처럼 2단계, 교육부서-영아부-1세반처럼
   3단계 등 교회마다 다른 깊이를 자유롭게 만들 수 있는 트리 구조.
   ========================================================= */

let orgUnits = [];
let selectedOrgUnitId = null;
let orgUnitMembers = []; // 지금 선택된 조직의 명단만 캐시
let orgAllUnitMembers = []; // 트리에 인원수를 표시하기 위한 전체 캐시
let orgPersonSearchKeyword = "";
let orgCollapsedIds = new Set(); // 접혀있는(자식 숨김) 조직 id
let orgTreeSearchKeyword = "";
let orgUnitRosterSearchKeyword = "";
// 조직 추가 입력창이 지금 어디에 열려있는지: undefined = 닫힘, null = 최상위, 그 외 = 해당 id의 하위
let addOrgFormParentId = undefined;

async function loadOrgUnits() {
  const [unitsSnap, membersSnap] = await Promise.all([
    churchCol("orgUnits").get(),
    churchCol("orgUnitMembers").get(),
  ]);
  orgUnits = unitsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  orgAllUnitMembers = membersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function childUnitsOf(parentId, allowedIds) {
  let list = orgUnits.filter((u) => (u.parentId || null) === parentId);
  if (allowedIds) list = list.filter((u) => allowedIds.has(u.id));
  return sortByName(list, (u) => u.name);
}

function memberCountOf(unitId) {
  return orgAllUnitMembers.filter((m) => m.orgUnitId === unitId).length;
}

/* 검색어가 있으면 이름/담당자에 일치하는 조직과 그 조상(경로)만 트리에
   남기고, 나머지는 감춤. 일치하는 조직은 하이라이트 표시. */
function orgSearchInfo() {
  const kw = orgTreeSearchKeyword.trim();
  if (!kw) return null;
  const directMatches = new Set();
  orgUnits.forEach((u) => {
    const leader = u.leaderParishionerId ? parishionerName(u.leaderParishionerId) : "";
    if (u.name.includes(kw) || (leader && leader.includes(kw))) {
      directMatches.add(u.id);
    }
  });
  const allowedIds = new Set(directMatches);
  directMatches.forEach((id) => {
    let cur = orgUnits.find((u) => u.id === id);
    while (cur && cur.parentId) {
      allowedIds.add(cur.parentId);
      cur = orgUnits.find((u) => u.id === cur.parentId);
    }
  });
  return { directMatches, allowedIds };
}

function renderOrgTree() {
  const wrap = document.getElementById("orgTreeWrap");
  const searchInfo = orgSearchInfo();
  const topLevel = childUnitsOf(null, searchInfo ? searchInfo.allowedIds : null);
  const topAddForm = addOrgFormParentId === null ? orgAddFormHtml() : "";
  if (topLevel.length === 0 && !topAddForm) {
    wrap.innerHTML = searchInfo
      ? '<div class="empty">검색 결과가 없습니다.</div>'
      : '<div class="empty">등록된 조직이 없습니다. 위 "+ 최상위 조직 추가" 버튼으로 시작해보세요.</div>';
    return;
  }
  wrap.innerHTML = `<div class="org-tree">${topAddForm}${topLevel.map((u) => orgUnitNodeHtml(u, searchInfo)).join("")}</div>`;
  bindOrgTreeEvents();
  const addInput = document.getElementById("orgAddInput");
  if (addInput) addInput.focus();
}

function orgUnitNodeHtml(unit, searchInfo) {
  const allowedIds = searchInfo ? searchInfo.allowedIds : null;
  const children = childUnitsOf(unit.id, allowedIds);
  const hasChildren = children.length > 0;
  const isAddingHere = addOrgFormParentId === unit.id;
  const open = searchInfo ? true : !orgCollapsedIds.has(unit.id) || isAddingHere;
  const leader = unit.leaderParishionerId ? parishionerName(unit.leaderParishionerId) : null;
  const count = memberCountOf(unit.id);
  const isMatch = searchInfo && searchInfo.directMatches.has(unit.id);
  const childrenHtml = `${isAddingHere ? orgAddFormHtml() : ""}${
    hasChildren && open ? children.map((c) => orgUnitNodeHtml(c, searchInfo)).join("") : ""
  }`;
  return `
    <div class="org-node">
      <div class="org-node-row ${unit.id === selectedOrgUnitId ? "selected" : ""} ${isMatch ? "org-search-match" : ""}" data-id="${unit.id}" data-act="select-org">
        <button type="button" class="org-toggle ${hasChildren ? "" : "org-toggle-empty"}" data-id="${unit.id}" data-act="toggle-org">
          ${hasChildren ? (open ? "▾" : "▸") : "·"}
        </button>
        <span class="org-icon" aria-hidden="true">${hasChildren ? "🗂" : "📁"}</span>
        <div class="list-card-main">
          <div class="list-card-title">
            ${escapeHtml(unit.name)}
            <span class="org-count-badge">${count}명</span>
          </div>
          <div class="list-card-sub">${leader ? "담당: " + escapeHtml(leader) : "담당 미지정"}</div>
        </div>
        <button type="button" class="btn ghost small" data-id="${unit.id}" data-act="add-child-org">+ 하위조직</button>
        <button type="button" class="visit-delete" data-id="${unit.id}" data-act="delete-org">삭제</button>
      </div>
      ${childrenHtml ? `<div class="org-children">${childrenHtml}</div>` : ""}
    </div>
  `;
}

document.getElementById("orgTreeSearchInput").addEventListener("input", (e) => {
  orgTreeSearchKeyword = e.target.value;
  renderOrgTree();
});

/* 조직 이름을 입력하는 자리 - "+ 최상위 조직 추가"를 누르면 트리 맨 위에,
   특정 조직의 "+ 하위조직"을 누르면 바로 그 조직 아래(자식 자리)에 나타남 */
function orgAddFormHtml() {
  return `
    <div class="org-add-row">
      <input type="text" id="orgAddInput" placeholder="조직 이름 입력 (예: 성가대, 영아부, 1세반)" />
      <button type="button" class="btn small" id="orgAddSaveBtn">추가</button>
      <button type="button" class="btn ghost small" id="orgAddCancelBtn">취소</button>
    </div>
  `;
}

function bindOrgTreeEvents() {
  const wrap = document.getElementById("orgTreeWrap");
  wrap.querySelectorAll('[data-act="select-org"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      if (["add-child-org", "delete-org", "toggle-org"].includes(e.target.dataset.act)) return;
      selectOrgUnit(el.dataset.id);
    });
  });
  wrap.querySelectorAll('[data-act="toggle-org"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.classList.contains("org-toggle-empty")) return;
      toggleOrgCollapse(btn.dataset.id);
    });
  });
  wrap.querySelectorAll('[data-act="add-child-org"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      startAddOrgUnit(btn.dataset.id);
    });
  });
  wrap.querySelectorAll('[data-act="delete-org"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteOrgUnit(btn.dataset.id);
    });
  });
  const addInput = document.getElementById("orgAddInput");
  if (addInput) {
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitOrgAddForm();
      if (e.key === "Escape") cancelOrgAddForm();
    });
  }
  const saveBtn = document.getElementById("orgAddSaveBtn");
  if (saveBtn) saveBtn.addEventListener("click", submitOrgAddForm);
  const cancelBtn = document.getElementById("orgAddCancelBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", cancelOrgAddForm);
}

function toggleOrgCollapse(id) {
  if (orgCollapsedIds.has(id)) {
    orgCollapsedIds.delete(id);
  } else {
    orgCollapsedIds.add(id);
  }
  renderOrgTree();
}

/* ---------------------------------------------------------
   조직 추가/삭제 - 입력창은 항상 트리 안에서 딱 한 곳(맨 위 또는
   특정 조직 바로 아래)에만 열리므로, "지금 어디에 추가되는지"가
   위치만 봐도 헷갈리지 않도록 함
   --------------------------------------------------------- */
function startAddOrgUnit(parentId) {
  addOrgFormParentId = parentId; // 최상위면 null, 아니면 부모 조직 id
  if (parentId) orgCollapsedIds.delete(parentId);
  renderOrgTree();
}

document.getElementById("addTopOrgUnitBtn").addEventListener("click", () => {
  startAddOrgUnit(null);
  document.getElementById("orgTreeWrap").scrollIntoView({ behavior: "smooth", block: "start" });
});

function cancelOrgAddForm() {
  addOrgFormParentId = undefined;
  renderOrgTree();
}

async function submitOrgAddForm() {
  const nameEl = document.getElementById("orgAddInput");
  if (!nameEl.value.trim()) {
    nameEl.classList.add("field-error");
    return;
  }
  const parentId = addOrgFormParentId;
  try {
    await churchCol("orgUnits").add({
      parentId: parentId,
      name: nameEl.value.trim(),
      orderIndex: 0,
      createdAt: Date.now(),
      createdBy: (currentUser && currentUser.email) || "",
    });
    addOrgFormParentId = undefined;
    await loadOrgUnits();
    renderOrgTree();
    showToast("조직이 등록되었습니다.");
  } catch (e) {
    await alertDialog("저장 중 오류가 발생했습니다: " + (e.message || e));
  }
}

async function deleteOrgUnit(id) {
  const hasChildren = orgUnits.some((u) => u.parentId === id);
  const ok = await confirmDialog(
    hasChildren
      ? "이 조직을 삭제하시겠습니까?\n하위 조직과 그 소속 명단까지 모두 함께 삭제됩니다."
      : "이 조직을 삭제하시겠습니까?\n소속 명단도 함께 삭제됩니다.",
    "삭제",
    "취소",
  );
  if (!ok) return;
  try {
    await churchCol("orgUnits").doc(id).delete();
    if (selectedOrgUnitId === id) {
      selectedOrgUnitId = null;
      document.getElementById("orgUnitRosterWrap").style.display = "none";
    }
    if (addOrgFormParentId === id) addOrgFormParentId = undefined;
    await loadOrgUnits();
    renderOrgTree();
    showToast("삭제되었습니다.");
  } catch (e) {
    await alertDialog("저장 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* ---------------------------------------------------------
   조직 선택 -> 명단/담당자 관리
   --------------------------------------------------------- */
async function selectOrgUnit(unitId) {
  selectedOrgUnitId = unitId;
  renderOrgTree();
  const unit = orgUnits.find((u) => u.id === unitId);
  document.getElementById("orgUnitRosterTitle").textContent = `"${unit ? unit.name : ""}" 명단 관리`;
  document.getElementById("orgUnitRosterWrap").style.display = "";
  document.getElementById("orgLeaderSearch").value = unit && unit.leaderParishionerId ? parishionerName(unit.leaderParishionerId) : "";
  document.getElementById("orgLeaderResults").innerHTML = "";
  document.getElementById("orgMemberSearch").value = "";
  document.getElementById("orgMemberResults").innerHTML = "";
  orgUnitRosterSearchKeyword = "";
  document.getElementById("orgUnitRosterSearchInput").value = "";
  await loadOrgUnitMembers(unitId);
  renderOrgUnitRoster();
  document.getElementById("orgUnitRosterWrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function loadOrgUnitMembers(unitId) {
  const snap = await churchCol("orgUnitMembers").where("orgUnitId", "==", unitId).get();
  orgUnitMembers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function renderOrgUnitRoster() {
  const wrap = document.getElementById("orgUnitRosterList");
  if (orgUnitMembers.length === 0) {
    wrap.innerHTML = '<div class="empty">아직 등록된 사람이 없습니다.</div>';
    return;
  }
  const kw = orgUnitRosterSearchKeyword.trim();
  let rows = orgUnitMembers.map((m) => ({ ...m, name: parishionerName(m.parishionerId) })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  if (kw) rows = rows.filter((r) => r.name.includes(kw));
  if (rows.length === 0) {
    wrap.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }
  wrap.innerHTML = rows
    .map(
      (m) => `
      <div class="list-card" style="cursor: default">
        <div class="list-card-main">
          <div class="list-card-title">${escapeHtml(m.name)}</div>
          <div class="list-card-sub">${escapeHtml(m.roleLabel || "")}</div>
        </div>
        <button type="button" class="visit-delete" data-id="${m.id}" data-act="delete-org-member">삭제</button>
      </div>
    `,
    )
    .join("");
  wrap.querySelectorAll('[data-act="delete-org-member"]').forEach((btn) => {
    btn.addEventListener("click", () => deleteOrgUnitMember(btn.dataset.id));
  });
}

document.getElementById("orgUnitRosterSearchInput").addEventListener("input", (e) => {
  orgUnitRosterSearchKeyword = e.target.value;
  renderOrgUnitRoster();
});

async function deleteOrgUnitMember(id) {
  const ok = await confirmDialog("이 사람을 명단에서 삭제하시겠습니까?", "삭제", "취소");
  if (!ok) return;
  try {
    await churchCol("orgUnitMembers").doc(id).delete();
    await loadOrgUnitMembers(selectedOrgUnitId);
    orgAllUnitMembers = orgAllUnitMembers.filter((m) => m.id !== id);
    renderOrgUnitRoster();
    renderOrgTree();
    showToast("삭제되었습니다.");
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* 담당자(리더) 지정 */
document.getElementById("orgLeaderSearch").addEventListener("input", (e) => {
  orgPersonSearchKeyword = e.target.value;
  const wrap = document.getElementById("orgLeaderResults");
  const kw = orgPersonSearchKeyword.trim();
  if (!kw) {
    wrap.innerHTML = "";
    return;
  }
  const matches = sortByName(parishioners.filter((p) => p.name.includes(kw))).slice(0, 8);
  wrap.innerHTML = matches.map((p) => `<div class="picker-row" data-id="${p.id}">${escapeHtml(p.name)}</div>`).join("");
  wrap.querySelectorAll(".picker-row").forEach((row) => {
    row.addEventListener("click", () => setOrgLeader(row.dataset.id));
  });
});

async function setOrgLeader(parishionerId) {
  try {
    await churchCol("orgUnits").doc(selectedOrgUnitId).update({ leaderParishionerId: parishionerId });
    document.getElementById("orgLeaderSearch").value = parishionerName(parishionerId);
    document.getElementById("orgLeaderResults").innerHTML = "";
    await loadOrgUnits();
    renderOrgTree();
    showToast("담당자가 지정되었습니다.");
  } catch (e) {
    await alertDialog("저장 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* 명단에 사람 추가 */
document.getElementById("orgMemberSearch").addEventListener("input", (e) => {
  const wrap = document.getElementById("orgMemberResults");
  const kw = e.target.value.trim();
  if (!kw) {
    wrap.innerHTML = "";
    return;
  }
  const alreadyIn = new Set(orgUnitMembers.map((m) => m.parishionerId));
  const matches = sortByName(parishioners.filter((p) => p.name.includes(kw) && !alreadyIn.has(p.id))).slice(0, 8);
  if (matches.length === 0) {
    wrap.innerHTML = '<div class="empty" style="padding:8px 0">일치하는 교인이 없거나 이미 등록되어 있습니다.</div>';
    return;
  }
  wrap.innerHTML = matches.map((p) => `<div class="picker-row" data-id="${p.id}">${escapeHtml(p.name)}</div>`).join("");
  wrap.querySelectorAll(".picker-row").forEach((row) => {
    row.addEventListener("click", () => addOrgUnitMember(row.dataset.id));
  });
});

async function addOrgUnitMember(parishionerId) {
  try {
    const ref = await churchCol("orgUnitMembers").add({
      orgUnitId: selectedOrgUnitId,
      parishionerId,
      createdAt: Date.now(),
      createdBy: (currentUser && currentUser.email) || "",
    });
    orgAllUnitMembers.push({ id: ref.id, orgUnitId: selectedOrgUnitId, parishionerId });
    document.getElementById("orgMemberSearch").value = "";
    document.getElementById("orgMemberResults").innerHTML = "";
    await loadOrgUnitMembers(selectedOrgUnitId);
    renderOrgUnitRoster();
    renderOrgTree();
    showToast("등록되었습니다.");
  } catch (e) {
    if (e.code === "23505") {
      await alertDialog("이미 이 조직에 등록된 교인입니다.");
    } else {
      await alertDialog("등록 중 오류가 발생했습니다: " + (e.message || e));
    }
  }
}
