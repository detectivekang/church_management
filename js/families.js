/* =========================================================
   가족관리 - 한 사람은 한 가족에만 속합니다(단순화된 모델).
   parishioners.familyId가 families.id를 가리킵니다.
   ========================================================= */

let families = [];
let selectedFamilyId = null;
let familySearchKeyword = "";
let familyRosterSearchKeyword = "";

const FAMILY_ROLE_OPTIONS = ["본인", "배우자", "자녀", "부모", "기타"];

async function loadFamilies() {
  const snap = await churchCol("families").get();
  families = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function familyMembersOf(familyId) {
  return sortByName(parishioners.filter((p) => p.familyId === familyId));
}

function filteredFamilies() {
  const kw = familySearchKeyword.trim();
  const list = sortByName(families);
  if (!kw) return list;
  return list.filter((f) => [f.name, f.address].filter(Boolean).join(" ").includes(kw));
}

function renderFamilyList() {
  const wrap = document.getElementById("familyList");
  if (families.length === 0) {
    wrap.innerHTML = '<div class="empty">등록된 가족이 없습니다.</div>';
    return;
  }
  const list = filteredFamilies();
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }
  wrap.innerHTML = list
    .map((f) => {
      const count = familyMembersOf(f.id).length;
      return `
        <div class="list-card ${f.id === selectedFamilyId ? "selected" : ""}" data-id="${f.id}" data-act="select-family">
          <div class="list-card-main">
            <div class="list-card-title">${escapeHtml(f.name)}</div>
            <div class="list-card-sub">구성원 ${count}명${f.address ? " · " + escapeHtml(f.address) : ""}</div>
          </div>
          <button type="button" class="visit-delete" data-id="${f.id}" data-act="delete-family">삭제</button>
        </div>
      `;
    })
    .join("");
  wrap.querySelectorAll('[data-act="select-family"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.dataset.act === "delete-family") return;
      selectFamily(el.dataset.id);
    });
  });
  wrap.querySelectorAll('[data-act="delete-family"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteFamily(btn.dataset.id);
    });
  });
}

document.getElementById("familySearchInput").addEventListener("input", (e) => {
  familySearchKeyword = e.target.value;
  renderFamilyList();
});

document.getElementById("addFamilyBtn").addEventListener("click", async () => {
  const nameEl = document.getElementById("newFamilyName");
  const addrEl = document.getElementById("newFamilyAddress");
  if (!nameEl.value.trim()) {
    nameEl.classList.add("field-error");
    return;
  }
  nameEl.classList.remove("field-error");
  try {
    await churchCol("families").add({
      name: nameEl.value.trim(),
      address: addrEl.value.trim(),
      createdAt: Date.now(),
      createdBy: (currentUser && currentUser.email) || "",
    });
    nameEl.value = "";
    addrEl.value = "";
    await loadFamilies();
    renderFamilyList();
    showToast("가족이 등록되었습니다.");
  } catch (e) {
    await alertDialog("저장 중 오류가 발생했습니다: " + (e.message || e));
  }
});

async function deleteFamily(id) {
  const count = familyMembersOf(id).length;
  const ok = await confirmDialog(
    count > 0
      ? `이 가족을 삭제하시겠습니까?\n소속된 ${count}명은 가족 미지정 상태가 됩니다(교인 정보 자체는 삭제되지 않습니다).`
      : "이 가족을 삭제하시겠습니까?",
    "삭제",
    "취소",
  );
  if (!ok) return;
  try {
    await churchCol("families").doc(id).delete();
    if (selectedFamilyId === id) {
      selectedFamilyId = null;
      document.getElementById("familyRosterWrap").style.display = "none";
    }
    await loadFamilies();
    await loadParishioners(); // family_id가 null로 바뀐 사람들 반영
    renderFamilyList();
    showToast("삭제되었습니다.");
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* ---------------------------------------------------------
   가족 선택 -> 구성원 관리
   --------------------------------------------------------- */
function selectFamily(familyId) {
  selectedFamilyId = familyId;
  renderFamilyList();
  const family = families.find((f) => f.id === familyId);
  document.getElementById("familyRosterTitle").textContent = `"${family ? family.name : ""}" 구성원`;
  document.getElementById("familyRosterWrap").style.display = "";
  document.getElementById("familyMemberSearch").value = "";
  document.getElementById("familyMemberResults").innerHTML = "";
  familyRosterSearchKeyword = "";
  document.getElementById("familyRosterSearchInput").value = "";
  renderFamilyRoster();
  document.getElementById("familyRosterWrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderFamilyRoster() {
  const wrap = document.getElementById("familyRosterList");
  const members = familyMembersOf(selectedFamilyId);
  if (members.length === 0) {
    wrap.innerHTML = '<div class="empty">아직 등록된 구성원이 없습니다.</div>';
    return;
  }
  const kw = familyRosterSearchKeyword.trim();
  const filteredMembers = kw ? members.filter((p) => p.name.includes(kw)) : members;
  if (filteredMembers.length === 0) {
    wrap.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }
  const roleOpts = (current) =>
    FAMILY_ROLE_OPTIONS.map((r) => `<option value="${r}" ${r === current ? "selected" : ""}>${r}</option>`).join("");
  wrap.innerHTML = filteredMembers
    .map(
      (p) => `
      <div class="list-card" style="cursor: default">
        <div class="list-card-main">
          <div class="list-card-title">${escapeHtml(p.name)}</div>
        </div>
        <select data-id="${p.id}" data-act="change-family-role" class="roster-status-select">
          <option value="">관계 선택</option>
          ${roleOpts(p.familyRole)}
        </select>
        <button type="button" class="visit-delete" data-id="${p.id}" data-act="remove-from-family">제외</button>
      </div>
    `,
    )
    .join("");
  wrap.querySelectorAll('[data-act="change-family-role"]').forEach((sel) => {
    sel.addEventListener("change", () => updateFamilyRole(sel.dataset.id, sel.value));
  });
  wrap.querySelectorAll('[data-act="remove-from-family"]').forEach((btn) => {
    btn.addEventListener("click", () => removeFromFamily(btn.dataset.id));
  });
}

document.getElementById("familyRosterSearchInput").addEventListener("input", (e) => {
  familyRosterSearchKeyword = e.target.value;
  renderFamilyRoster();
});

async function updateFamilyRole(parishionerId, role) {
  try {
    await churchCol("parishioners").doc(parishionerId).update({ familyRole: role });
    await loadParishioners();
    renderFamilyRoster();
    renderFamilyList();
  } catch (e) {
    await alertDialog("변경 중 오류가 발생했습니다: " + (e.message || e));
  }
}

async function removeFromFamily(parishionerId) {
  const ok = await confirmDialog("이 사람을 가족에서 제외하시겠습니까?\n(교인 정보 자체는 삭제되지 않습니다)", "제외", "취소");
  if (!ok) return;
  try {
    await churchCol("parishioners").doc(parishionerId).update({ familyId: null, familyRole: "" });
    await loadParishioners();
    renderFamilyRoster();
    renderFamilyList();
    showToast("제외되었습니다.");
  } catch (e) {
    await alertDialog("처리 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* ---------------------------------------------------------
   구성원 추가 (이름 검색) - 이미 다른 가족 소속이면 이동 확인
   --------------------------------------------------------- */
document.getElementById("familyMemberSearch").addEventListener("input", (e) => {
  const wrap = document.getElementById("familyMemberResults");
  const kw = e.target.value.trim();
  if (!kw) {
    wrap.innerHTML = "";
    return;
  }
  const matches = sortByName(
    parishioners.filter((p) => p.name.includes(kw) && p.familyId !== selectedFamilyId),
  ).slice(0, 8);
  if (matches.length === 0) {
    wrap.innerHTML = '<div class="empty" style="padding:8px 0">일치하는 교인이 없습니다.</div>';
    return;
  }
  wrap.innerHTML = matches
    .map((p) => {
      const currentFamily = p.familyId ? families.find((f) => f.id === p.familyId) : null;
      const note = currentFamily ? ` <span class="sms-recipient-sub">(현재: ${escapeHtml(currentFamily.name)})</span>` : "";
      return `<div class="picker-row" data-id="${p.id}">${escapeHtml(p.name)}${note}</div>`;
    })
    .join("");
  wrap.querySelectorAll(".picker-row").forEach((row) => {
    row.addEventListener("click", () => addToFamily(row.dataset.id));
  });
});

async function addToFamily(parishionerId) {
  const person = parishioners.find((p) => p.id === parishionerId);
  if (person && person.familyId) {
    const currentFamily = families.find((f) => f.id === person.familyId);
    const ok = await confirmDialog(
      `${person.name}님은 이미 "${currentFamily ? currentFamily.name : "다른 가족"}"에 속해있습니다.\n이 가족으로 옮기시겠습니까?`,
      "옮기기",
      "취소",
    );
    if (!ok) return;
  }
  try {
    await churchCol("parishioners").doc(parishionerId).update({ familyId: selectedFamilyId });
    document.getElementById("familyMemberSearch").value = "";
    document.getElementById("familyMemberResults").innerHTML = "";
    await loadParishioners();
    renderFamilyRoster();
    renderFamilyList();
    showToast("등록되었습니다.");
  } catch (e) {
    await alertDialog("등록 중 오류가 발생했습니다: " + (e.message || e));
  }
}
