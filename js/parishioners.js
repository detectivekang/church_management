/* =========================================================
   교인 상세정보 관리 (교적)
   ========================================================= */

const MEMBER_STATUS_LABEL = {
  active: "재적",
  transferred: "이명",
  inactive: "장기결석",
  deceased: "소천",
  removed: "제적",
};

async function loadParishioners() {
  const snap = await churchCol("parishioners").get();
  parishioners = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function calcAge(birthDate) {
  if (!birthDate) return null;
  const parts = birthDate.split("-");
  if (parts.length !== 3) return null;
  const birthYear = Number(parts[0]);
  if (!birthYear) return null;
  return new Date().getFullYear() - birthYear + 1; // 한국 나이(세는나이)
}

function filteredParishioners() {
  const kw = parishionerSearchKeyword.trim();
  return sortByName(
    parishioners.filter((p) => {
      if (parishionerStatusFilter !== "all" && p.memberStatus !== parishionerStatusFilter) {
        return false;
      }
      if (!kw) return true;
      const haystack = [p.name, p.phone, p.department, p.cell, p.district]
        .filter(Boolean)
        .join(" ");
      return haystack.includes(kw);
    }),
  );
}

function renderParishionerList() {
  const listEl = document.getElementById("parishionerList");
  const countEl = document.getElementById("parishionerCount");
  const list = filteredParishioners();
  countEl.textContent = `총 ${list.length}명 (전체 등록 ${parishioners.length}명)`;

  if (list.length === 0) {
    listEl.innerHTML = '<div class="empty">등록된 교인이 없습니다.</div>';
    return;
  }

  const familyOf = (familyId) => (typeof families !== "undefined" ? families.find((f) => f.id === familyId) : null);

  listEl.innerHTML = `
    <div class="parishioner-table-wrap">
      <table class="parishioner-table">
        <thead>
          <tr>
            <th></th>
            <th>이름</th>
            <th>성별</th>
            <th>나이</th>
            <th>생년월일</th>
            <th>직분</th>
            <th>부서</th>
            <th>구역/속</th>
            <th>전화번호</th>
            <th>신급</th>
            <th>가족</th>
            <th>등록일</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map((p) => {
              const age = calcAge(p.birthDate);
              const genderLabel = p.gender === "M" ? "남" : p.gender === "F" ? "여" : "-";
              const thumb = p.photoUrl
                ? `<div class="list-avatar pt-avatar"><img src="${p.photoUrl}" alt="" /></div>`
                : `<div class="list-avatar pt-avatar list-avatar-empty">${escapeHtml((p.name || "").slice(0, 1))}</div>`;
              const isActive = !p.memberStatus || p.memberStatus === "active";
              const statusBadge = isActive
                ? `<span class="badge badge-active">재적</span>`
                : `<span class="badge muted">${escapeHtml(MEMBER_STATUS_LABEL[p.memberStatus] || p.memberStatus)}</span>`;
              const fam = familyOf(p.familyId);
              const famCell = fam
                ? `${escapeHtml(fam.name)}${p.familyRole ? `<span class="pt-muted">(${escapeHtml(p.familyRole)})</span>` : ""}`
                : "-";
              return `
                <tr data-id="${p.id}" data-role="parishioner-open">
                  <td>${thumb}</td>
                  <td class="pt-name">${escapeHtml(p.name)}</td>
                  <td>${genderLabel}</td>
                  <td>${age ? age + "세" : "-"}</td>
                  <td>${p.birthDate ? escapeHtml(p.birthDate) : "-"}</td>
                  <td>${p.position ? escapeHtml(p.position) : "-"}</td>
                  <td>${p.department ? escapeHtml(p.department) : "-"}</td>
                  <td>${p.cell || p.district ? escapeHtml(p.cell || p.district) : "-"}</td>
                  <td>${p.phone ? escapeHtml(p.phone) : "-"}</td>
                  <td>${p.faithLevel ? escapeHtml(p.faithLevel) : "-"}</td>
                  <td>${famCell}</td>
                  <td>${p.registrationDate ? escapeHtml(p.registrationDate) : "-"}</td>
                  <td>${statusBadge}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  listEl.querySelectorAll('[data-role="parishioner-open"]').forEach((el) => {
    el.addEventListener("click", () => openParishionerModal(el.dataset.id));
  });
}

document.getElementById("parishionerSearchInput").addEventListener("input", (e) => {
  parishionerSearchKeyword = e.target.value;
  renderParishionerList();
});
document.getElementById("parishionerStatusFilter").addEventListener("change", (e) => {
  parishionerStatusFilter = e.target.value;
  renderParishionerList();
});
document.getElementById("addParishionerBtn").addEventListener("click", () => {
  openParishionerModal(null);
});

/* ---------------------------------------------------------
   등록/수정 모달 - 4개 정보 탭(기본정보/신앙·소속/가족·직장/기타·자유입력)
   + 기존 교인이면 심방기록 탭
   --------------------------------------------------------- */
const PARISHIONER_FIELDS = [
  {
    title: "기본정보",
    tab: "basic",
    fields: [
      ["name", "이름 *", "text"],
      ["gender", "성별", "select", [["", "선택"], ["M", "남"], ["F", "여"]]],
      ["birthDate", "생년월일", "date"],
      ["birthDateCalendar", "음/양력", "select", [["solar", "양력"], ["lunar", "음력"]]],
      ["phone", "휴대전화", "text"],
      ["phoneHome", "자택전화", "text"],
      ["email", "이메일", "text"],
    ],
  },
  {
    title: "등록정보",
    tab: "basic",
    fields: [
      ["registrationDate", "등록일", "date"],
      [
        "registrationRoute",
        "등록경로",
        "select",
        [["", "선택"], ["새신자", "새신자"], ["전입", "전입"], ["유아세례", "유아세례"], ["재등록", "재등록"]],
      ],
      [
        "memberStatus",
        "재적상태",
        "select",
        [["active", "재적"], ["inactive", "장기결석"], ["transferred", "이명"], ["removed", "제적"], ["deceased", "소천"]],
      ],
      ["statusNote", "상태 메모 (예: 이명한 교회명)", "text"],
    ],
  },
  {
    title: "신앙정보",
    tab: "faith",
    fields: [
      ["faithLevel", "신급", "select", [["", "선택"], ["원입", "원입"], ["학습", "학습"], ["세례", "세례"], ["입교", "입교"]]],
      ["baptismDate", "세례일", "date"],
      ["baptismChurch", "세례교회", "text"],
      ["confirmationDate", "입교일", "date"],
      ["position", "직분", "text"],
      ["positionDate", "직분 임직일", "date"],
    ],
  },
  {
    title: "소속정보",
    tab: "faith",
    fields: [
      ["department", "소속부서", "text"],
      ["district", "교구", "text"],
      ["cell", "구역/속", "text"],
      ["transferredFromChurch", "이전 출석 교회", "text"],
      ["assignedPastorEmail", "담당 교역자 이메일", "text"],
    ],
  },
  {
    title: "가족정보",
    tab: "family",
    fields: [
      ["maritalStatus", "결혼상태", "select", [["", "선택"], ["미혼", "미혼"], ["기혼", "기혼"], ["사별", "사별"], ["이혼", "이혼"]]],
      ["spouseName", "배우자 성명", "text"],
      ["weddingAnniversary", "결혼기념일", "date"],
    ],
  },
  {
    title: "직장/학력",
    tab: "family",
    fields: [
      ["occupation", "직업", "text"],
      ["workplace", "직장", "text"],
      ["educationLevel", "최종학력", "text"],
      ["talents", "은사/특기", "text"],
      ["ministryArea", "봉사분야", "text"],
    ],
  },
  {
    title: "비상연락/기타",
    tab: "etc",
    fields: [
      ["bloodType", "혈액형", "select", [["", "선택"], ["A", "A"], ["B", "B"], ["O", "O"], ["AB", "AB"]]],
      ["emergencyContactName", "비상연락처(이름)", "text"],
      ["emergencyContactPhone", "비상연락처(전화)", "text"],
    ],
  },
  {
    title: "비고",
    tab: "etc",
    fields: [["notes", "비고", "textarea"]],
  },
];

function sectionByTitle(title) {
  return PARISHIONER_FIELDS.find((s) => s.title === title);
}

function fieldInputHtml(key, label, type, options, value) {
  const v = value == null ? "" : value;
  if (type === "select") {
    const opts = options
      .map(([optVal, optLabel]) => `<option value="${escapeHtml(optVal)}" ${optVal === v ? "selected" : ""}>${escapeHtml(optLabel)}</option>`)
      .join("");
    return `<select id="pf_${key}">${opts}</select>`;
  }
  if (type === "textarea") {
    return `<textarea id="pf_${key}" rows="2">${escapeHtml(v)}</textarea>`;
  }
  const readonly = type === "readonly" ? "readonly" : "";
  const realType = type === "readonly" ? "text" : type;
  return `<input id="pf_${key}" type="${realType}" value="${escapeHtml(v)}" ${readonly} />`;
}

function sectionHtml(section, data) {
  if (!section) return "";
  return `
    <div class="form-section">
      <div class="form-section-title">${escapeHtml(section.title)}</div>
      <div class="form-grid">
        ${section.fields
          .map(
            ([key, label, type, options]) => `
          <div class="form-field">
            <label for="pf_${key}">${escapeHtml(label)}</label>
            ${fieldInputHtml(key, label, type, options, data[key])}
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
}

/* ---- 사진 업로드 ---- */
function photoBlockHtml(data) {
  const photo = data.photoUrl || "";
  return `
    <div class="form-section">
      <div class="photo-upload-row">
        <div class="photo-preview" id="pf_photoPreview">${
          photo ? `<img src="${photo}" alt="" />` : `<span class="photo-preview-empty">사진</span>`
        }</div>
        <div class="photo-upload-actions">
          <label class="btn ghost small photo-upload-btn">
            사진 선택
            <input type="file" id="pf_photoFile" accept="image/*" style="display:none" />
          </label>
          <button type="button" class="btn ghost small" id="pf_photoRemoveBtn" style="${photo ? "" : "display:none"}; margin-left:6px">삭제</button>
          <div class="hint-text" style="margin-top:6px; margin-left:0">정사각형 사진 권장 · 저장 시 자동으로 축소됩니다</div>
        </div>
      </div>
      <input type="hidden" id="pf_photoUrl" value="${escapeHtml(photo)}" />
    </div>
  `;
}

function resizeImageToDataUrl(file, maxSize) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.onload = () => {
      img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function bindPhotoUploadEvents() {
  const fileEl = document.getElementById("pf_photoFile");
  const removeBtn = document.getElementById("pf_photoRemoveBtn");
  fileEl.addEventListener("change", async () => {
    const file = fileEl.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 320);
      document.getElementById("pf_photoUrl").value = dataUrl;
      document.getElementById("pf_photoPreview").innerHTML = `<img src="${dataUrl}" alt="" />`;
      removeBtn.style.display = "";
    } catch (e) {
      await alertDialog("사진을 처리하는 중 오류가 발생했습니다: " + (e.message || e));
    } finally {
      fileEl.value = "";
    }
  });
  removeBtn.addEventListener("click", () => {
    document.getElementById("pf_photoUrl").value = "";
    document.getElementById("pf_photoPreview").innerHTML = '<span class="photo-preview-empty">사진</span>';
    removeBtn.style.display = "none";
  });
}

/* ---- 주소 (다음 우편번호 검색) ---- */
function addressBlockHtml(data) {
  return `
    <div class="form-section">
      <div class="form-section-title">주소</div>
      <div class="form-grid">
        <div class="form-field">
          <label for="pf_zonecode">우편번호</label>
          <div style="display:flex; gap:6px">
            <input id="pf_zonecode" type="text" value="${escapeHtml(data.zonecode)}" readonly />
            <button type="button" class="btn ghost small" id="pf_addressSearchBtn" style="flex-shrink:0; white-space:nowrap">주소 검색</button>
          </div>
        </div>
        <div class="form-field" style="grid-column: 1 / -1">
          <label for="pf_address">주소</label>
          <input id="pf_address" type="text" value="${escapeHtml(data.address)}" readonly />
        </div>
        <div class="form-field" style="grid-column: 1 / -1">
          <label for="pf_addressDetail">상세주소</label>
          <input id="pf_addressDetail" type="text" value="${escapeHtml(data.addressDetail)}" placeholder="동/호수 등" />
        </div>
      </div>
    </div>
  `;
}

function bindAddressSearchEvent() {
  document.getElementById("pf_addressSearchBtn").addEventListener("click", () => {
    if (typeof daum === "undefined" || !daum.Postcode) {
      alertDialog("주소 검색 기능을 불러오지 못했습니다. 인터넷 연결을 확인해주세요.");
      return;
    }
    new daum.Postcode({
      oncomplete(result) {
        document.getElementById("pf_zonecode").value = result.zonecode || "";
        document.getElementById("pf_address").value = result.roadAddress || result.jibunAddress || "";
        document.getElementById("pf_addressDetail").focus();
      },
    }).open();
  });
}

/* ---- 문자수신거부 / 인도자 (extra 저장) ---- */
function smsOptOutBlockHtml(data) {
  const extra = data.extra || {};
  return `
    <div class="form-field checkbox-field">
      <label class="checkbox-label">
        <input type="checkbox" id="pf_extra_smsOptOut" ${extra.smsOptOut ? "checked" : ""} />
        문자 수신 거부
      </label>
    </div>
  `;
}

function referrerBlockHtml(data) {
  const extra = data.extra || {};
  return `
    <div class="form-section">
      <div class="form-section-title">인도자</div>
      <div class="form-grid">
        <div class="form-field">
          <label for="pf_extra_referrer1">인도자1</label>
          <input id="pf_extra_referrer1" type="text" value="${escapeHtml(extra.referrer1)}" />
        </div>
        <div class="form-field">
          <label for="pf_extra_referrer2">인도자2</label>
          <input id="pf_extra_referrer2" type="text" value="${escapeHtml(extra.referrer2)}" />
        </div>
      </div>
    </div>
  `;
}

/* ---- 소속 가족 (읽기전용 안내 - 실제 지정/변경은 "가족 관리" 탭에서) ---- */
function familyInfoBlockHtml(data) {
  const family = data.familyId ? families.find((f) => f.id === data.familyId) : null;
  return `
    <div class="form-section">
      <div class="form-section-title">소속 가족</div>
      <div class="hint-text" style="margin-top:0">
        ${
          family
            ? `현재 <strong>${escapeHtml(family.name)}</strong>${data.familyRole ? " · " + escapeHtml(data.familyRole) : ""}에 소속되어 있습니다.`
            : "아직 지정된 가족이 없습니다."
        } 가족 지정/변경은 상단 메뉴의 "가족 관리"에서 할 수 있습니다.
      </div>
    </div>
  `;
}

/* ---- 기타 자유 입력 항목 (extra.customFields - 교회마다 다른 커스텀 항목) ---- */
let customFieldRowSeq = 0;
function customFieldRowHtml(label, value) {
  const idx = customFieldRowSeq++;
  return `
    <div class="custom-field-row" data-idx="${idx}">
      <input type="text" class="cf-label" placeholder="항목명 (예: 차량번호)" value="${escapeHtml(label || "")}" />
      <input type="text" class="cf-value" placeholder="내용" value="${escapeHtml(value || "")}" />
      <button type="button" class="custom-field-remove" data-act="remove-custom-field">삭제</button>
    </div>
  `;
}
function customFieldsBlockHtml(data) {
  const extra = data.extra || {};
  const fields = Array.isArray(extra.customFields) ? extra.customFields : [];
  const rows = fields.length
    ? fields.map((f) => customFieldRowHtml(f.label, f.value)).join("")
    : "";
  return `
    <div class="form-section">
      <div class="form-section-title">자유 입력 항목</div>
      <div class="hint-text" style="margin-top:0">이 교회에서만 따로 관리하고 싶은 항목을 자유롭게 추가하세요 (예: 차량번호, 소그룹명, 알레르기 등).</div>
      <div id="pf_customFieldsWrap" style="margin-top:8px">${rows}</div>
      <button type="button" class="btn ghost small" id="pf_addCustomFieldBtn" style="margin-top:8px">+ 항목 추가</button>
    </div>
  `;
}
function bindCustomFieldsEvents() {
  const wrap = document.getElementById("pf_customFieldsWrap");
  document.getElementById("pf_addCustomFieldBtn").addEventListener("click", () => {
    wrap.insertAdjacentHTML("beforeend", customFieldRowHtml("", ""));
    bindCustomFieldRemoveButtons();
  });
  bindCustomFieldRemoveButtons();
}
function bindCustomFieldRemoveButtons() {
  document.querySelectorAll('[data-act="remove-custom-field"]').forEach((btn) => {
    btn.onclick = () => btn.closest(".custom-field-row").remove();
  });
}

/* ---- 탭별 조립 ---- */
function tabBasicHtml(data) {
  return photoBlockHtml(data) + sectionHtml(sectionByTitle("기본정보"), data) + addressBlockHtml(data) +
    sectionHtml(sectionByTitle("등록정보"), data) + smsOptOutBlockHtml(data);
}
function tabFaithHtml(data) {
  return sectionHtml(sectionByTitle("신앙정보"), data) + sectionHtml(sectionByTitle("소속정보"), data) + referrerBlockHtml(data);
}
function tabFamilyHtml(data) {
  return sectionHtml(sectionByTitle("가족정보"), data) + familyInfoBlockHtml(data) + sectionHtml(sectionByTitle("직장/학력"), data);
}
function tabEtcHtml(data) {
  return sectionHtml(sectionByTitle("비상연락/기타"), data) + sectionHtml(sectionByTitle("비고"), data) + customFieldsBlockHtml(data);
}

const INFO_TABS = [
  { id: "basic", label: "기본정보", html: tabBasicHtml },
  { id: "faith", label: "신앙/소속", html: tabFaithHtml },
  { id: "family", label: "가족/직장", html: tabFamilyHtml },
  { id: "etc", label: "기타/자유입력", html: tabEtcHtml },
];

async function openParishionerModal(id) {
  editingParishionerId = id;
  parishionerModalTab = "basic";
  visitations = [];
  const existing = id ? parishioners.find((p) => p.id === id) : null;
  const data = existing || {};

  if (data.familyId && families.length === 0) {
    await loadFamilies();
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "parishionerModalOverlay";
  overlay.innerHTML = `
    <div class="modal-card wide">
      <div class="modal-title">${existing ? escapeHtml(existing.name) + " 님 정보" : "교인 등록"}</div>
      <div class="modal-tabs">
        ${INFO_TABS.map((t, i) => `<button type="button" class="modal-tab ${i === 0 ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("")}
        ${existing ? `<button type="button" class="modal-tab" data-tab="visits">심방기록</button>` : ""}
      </div>
      ${INFO_TABS.map(
        (t, i) => `<div class="modal-body scrollable" id="parishionerModalTab_${t.id}" style="display:${i === 0 ? "" : "none"}">${t.html(data)}</div>`,
      ).join("")}
      ${
        existing
          ? `<div class="modal-body scrollable" id="parishionerModalTab_visits" style="display: none">
               <div id="visitationListWrap"></div>
               <button type="button" class="btn small" id="addVisitationBtn" style="margin-top: 10px">+ 심방 기록 추가</button>
               <div id="visitationFormWrap"></div>
             </div>`
          : ""
      }
      <div class="modal-actions" id="parishionerModalActionsInfo">
        ${!existing ? `<label class="checkbox-label continue-entry-label"><input type="checkbox" id="pf_continueFamily" /> 저장 후 같은 가족 계속 등록</label>` : ""}
        ${existing ? '<button type="button" class="btn danger small" data-act="delete">삭제</button>' : ""}
        <button type="button" class="btn ghost small" data-act="cancel">취소</button>
        <button type="button" class="btn small" data-act="save">저장</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  bindPhotoUploadEvents();
  bindAddressSearchEvent();
  bindCustomFieldsEvents();

  overlay.querySelector('[data-act="cancel"]').addEventListener("click", closeParishionerModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeParishionerModal();
  });
  document.addEventListener("keydown", handleParishionerModalKeydown);
  overlay.querySelector('[data-act="save"]').addEventListener("click", saveParishionerFromModal);
  const deleteBtn = overlay.querySelector('[data-act="delete"]');
  if (deleteBtn) deleteBtn.addEventListener("click", () => deleteParishionerFromModal(id));

  overlay.querySelectorAll(".modal-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchParishionerModalTab(btn.dataset.tab, id));
  });
}

async function switchParishionerModalTab(tab, parishionerId) {
  parishionerModalTab = tab;
  const overlay = document.getElementById("parishionerModalOverlay");
  overlay.querySelectorAll(".modal-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  INFO_TABS.forEach((t) => {
    document.getElementById(`parishionerModalTab_${t.id}`).style.display = tab === t.id ? "" : "none";
  });
  const visitsTabEl = document.getElementById("parishionerModalTab_visits");
  if (visitsTabEl) visitsTabEl.style.display = tab === "visits" ? "" : "none";
  document.getElementById("parishionerModalActionsInfo").style.display = tab === "visits" ? "none" : "flex";

  if (tab === "visits") {
    if (visitations.length === 0) {
      document.getElementById("visitationListWrap").innerHTML = '<div class="empty">불러오는 중...</div>';
      await loadVisitations(parishionerId);
    }
    renderVisitationList(parishionerId);
  }
}

function handleParishionerModalKeydown(e) {
  if (e.key === "Escape") closeParishionerModal();
}

function closeParishionerModal() {
  const overlay = document.getElementById("parishionerModalOverlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", handleParishionerModalKeydown);
  editingParishionerId = null;
  visitations = [];
}

function collectParishionerPayload() {
  const payload = {};
  PARISHIONER_FIELDS.forEach((section) => {
    section.fields.forEach(([key]) => {
      const el = document.getElementById(`pf_${key}`);
      if (el) payload[key] = el.value.trim ? el.value.trim() : el.value;
    });
  });
  payload.photoUrl = document.getElementById("pf_photoUrl").value;
  payload.zonecode = document.getElementById("pf_zonecode").value;
  payload.address = document.getElementById("pf_address").value;
  payload.addressDetail = document.getElementById("pf_addressDetail").value.trim();

  const customFields = [];
  document.querySelectorAll("#pf_customFieldsWrap .custom-field-row").forEach((row) => {
    const label = row.querySelector(".cf-label").value.trim();
    const value = row.querySelector(".cf-value").value.trim();
    if (label) customFields.push({ label, value });
  });
  payload.extra = {
    smsOptOut: document.getElementById("pf_extra_smsOptOut").checked,
    referrer1: document.getElementById("pf_extra_referrer1").value.trim(),
    referrer2: document.getElementById("pf_extra_referrer2").value.trim(),
    customFields,
  };
  return payload;
}

async function saveParishionerFromModal() {
  const nameEl = document.getElementById("pf_name");
  if (!nameEl.value.trim()) {
    switchParishionerModalTab("basic", editingParishionerId);
    nameEl.classList.add("field-error");
    nameEl.focus();
    return;
  }

  const payload = collectParishionerPayload();
  payload.updatedAt = Date.now();

  const continueEl = document.getElementById("pf_continueFamily");
  const shouldContinue = !editingParishionerId && continueEl && continueEl.checked;

  const saveBtn = document.querySelector('#parishionerModalOverlay [data-act="save"]');
  saveBtn.disabled = true;
  try {
    if (editingParishionerId) {
      await churchCol("parishioners").doc(editingParishionerId).update(payload);
    } else {
      payload.createdAt = Date.now();
      payload.createdBy = (currentUser && currentUser.email) || "";
      await churchCol("parishioners").add(payload);
    }
    await loadParishioners();
    renderParishionerList();
    if (shouldContinue) {
      showToast("등록되었습니다. 이어서 가족 구성원을 등록해보세요.");
      resetModalForContinuousFamilyEntry();
    } else {
      closeParishionerModal();
      showToast(editingParishionerId ? "수정되었습니다." : "등록되었습니다.");
    }
  } catch (e) {
    await alertDialog("저장 중 오류가 발생했습니다: " + (e.message || e));
  } finally {
    saveBtn.disabled = false;
  }
}

/* "저장 후 같은 가족 계속 등록" - 이름/생년월일/연락처/사진/신앙정보처럼
   사람마다 다른 항목만 비우고, 주소/등록정보처럼 같은 가족이면 보통
   똑같은 항목은 남겨둔 채로 계속 입력할 수 있게 함 */
function resetModalForContinuousFamilyEntry() {
  ["name", "phone", "phoneHome", "email", "faithLevel", "baptismDate", "baptismChurch", "confirmationDate", "position", "positionDate"].forEach(
    (key) => {
      const el = document.getElementById(`pf_${key}`);
      if (el) el.value = "";
    },
  );
  const genderEl = document.getElementById("pf_gender");
  if (genderEl) genderEl.value = "";
  const birthDateEl = document.getElementById("pf_birthDate");
  if (birthDateEl) birthDateEl.value = "";
  document.getElementById("pf_photoUrl").value = "";
  document.getElementById("pf_photoPreview").innerHTML = '<span class="photo-preview-empty">사진</span>';
  document.getElementById("pf_photoRemoveBtn").style.display = "none";
  switchParishionerModalTab("basic", null);
  document.getElementById("pf_name").classList.remove("field-error");
  document.getElementById("pf_name").focus();
}

async function deleteParishionerFromModal(id) {
  const ok = await confirmDialog("이 교인 정보를 삭제하시겠습니까?\n(출석 기록 등 다른 자료에는 영향을 주지 않습니다)", "삭제", "취소");
  if (!ok) return;
  try {
    await churchCol("parishioners").doc(id).delete();
    await loadParishioners();
    renderParishionerList();
    closeParishionerModal();
    showToast("삭제되었습니다.");
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* ---------------------------------------------------------
   심방기록 (parishioner 모달의 "심방기록" 탭)
   --------------------------------------------------------- */
const VISIT_TYPE_OPTIONS = ["정기심방", "특별심방", "병원심방", "경조사심방", "신급심방", "전화심방", "기타"];

async function loadVisitations(parishionerId) {
  const snap = await churchCol("visitations").where("parishionerId", "==", parishionerId).get();
  visitations = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.visitDate || "").localeCompare(a.visitDate || ""));
}

function renderVisitationList(parishionerId) {
  const wrap = document.getElementById("visitationListWrap");
  if (visitations.length === 0) {
    wrap.innerHTML = '<div class="empty">아직 심방기록이 없습니다.</div>';
    return;
  }
  wrap.innerHTML = visitations
    .map((v) => {
      const followUp = v.followUpNeeded
        ? `<span class="badge muted">후속 필요${v.followUpDate ? " · " + escapeHtml(v.followUpDate) : ""}</span>`
        : "";
      return `
        <div class="visit-card" data-id="${v.id}">
          <div class="visit-card-head">
            <strong>${escapeHtml(v.visitDate || "")}</strong>
            <span class="visit-type">${escapeHtml(v.visitType || "")}</span>
            ${v.location ? `<span class="visit-location">${escapeHtml(v.location)}</span>` : ""}
            ${followUp}
            <button type="button" class="visit-delete" data-act="delete-visit" data-id="${v.id}">삭제</button>
          </div>
          ${v.content ? `<div class="visit-content">${escapeHtml(v.content)}</div>` : ""}
          ${v.prayerRequest ? `<div class="visit-prayer">기도제목: ${escapeHtml(v.prayerRequest)}</div>` : ""}
        </div>
      `;
    })
    .join("");

  wrap.querySelectorAll('[data-act="delete-visit"]').forEach((btn) => {
    btn.addEventListener("click", () => deleteVisitation(btn.dataset.id, parishionerId));
  });
}

document.body.addEventListener("click", (e) => {
  if (e.target && e.target.id === "addVisitationBtn") {
    openVisitationForm();
  }
});

function openVisitationForm() {
  const formWrap = document.getElementById("visitationFormWrap");
  const typeOptions = VISIT_TYPE_OPTIONS.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  formWrap.innerHTML = `
    <div class="visit-form">
      <div class="form-grid">
        <div class="form-field">
          <label for="vf_visitDate">심방일</label>
          <input id="vf_visitDate" type="date" value="${todayStr()}" />
        </div>
        <div class="form-field">
          <label for="vf_visitType">종류</label>
          <select id="vf_visitType">${typeOptions}</select>
        </div>
        <div class="form-field">
          <label for="vf_location">장소</label>
          <input id="vf_location" type="text" placeholder="자택 / 병원 / 전화 등" />
        </div>
        <div class="form-field">
          <label for="vf_followUpNeeded">후속 심방 필요</label>
          <select id="vf_followUpNeeded">
            <option value="false">아니오</option>
            <option value="true">예</option>
          </select>
        </div>
        <div class="form-field">
          <label for="vf_followUpDate">후속 심방 예정일</label>
          <input id="vf_followUpDate" type="date" />
        </div>
      </div>
      <div class="form-field">
        <label for="vf_content">심방 내용</label>
        <textarea id="vf_content" rows="3"></textarea>
      </div>
      <div class="form-field">
        <label for="vf_prayerRequest">기도제목</label>
        <textarea id="vf_prayerRequest" rows="2"></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost small" id="cancelVisitationBtn">취소</button>
        <button type="button" class="btn small" id="saveVisitationBtn">기록 저장</button>
      </div>
    </div>
  `;
  document.getElementById("addVisitationBtn").style.display = "none";
  document.getElementById("cancelVisitationBtn").addEventListener("click", () => {
    formWrap.innerHTML = "";
    document.getElementById("addVisitationBtn").style.display = "";
  });
  document.getElementById("saveVisitationBtn").addEventListener("click", saveVisitationFromForm);
}

async function saveVisitationFromForm() {
  const parishionerId = editingParishionerId;
  const payload = {
    parishionerId,
    visitDate: document.getElementById("vf_visitDate").value,
    visitType: document.getElementById("vf_visitType").value,
    location: document.getElementById("vf_location").value.trim(),
    content: document.getElementById("vf_content").value.trim(),
    prayerRequest: document.getElementById("vf_prayerRequest").value.trim(),
    followUpNeeded: document.getElementById("vf_followUpNeeded").value === "true",
    followUpDate: document.getElementById("vf_followUpDate").value,
    visitorEmail: (currentUser && currentUser.email) || "",
    createdAt: Date.now(),
    createdBy: (currentUser && currentUser.email) || "",
  };
  if (!payload.visitDate) {
    await alertDialog("심방일을 입력해주세요.");
    return;
  }
  const saveBtn = document.getElementById("saveVisitationBtn");
  saveBtn.disabled = true;
  try {
    await churchCol("visitations").add(payload);
    document.getElementById("visitationFormWrap").innerHTML = "";
    document.getElementById("addVisitationBtn").style.display = "";
    await loadVisitations(parishionerId);
    renderVisitationList(parishionerId);
    showToast("심방기록이 저장되었습니다.");
  } catch (e) {
    await alertDialog("저장 중 오류가 발생했습니다: " + (e.message || e));
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteVisitation(visitId, parishionerId) {
  const ok = await confirmDialog("이 심방기록을 삭제하시겠습니까?", "삭제", "취소");
  if (!ok) return;
  try {
    await churchCol("visitations").doc(visitId).delete();
    await loadVisitations(parishionerId);
    renderVisitationList(parishionerId);
    showToast("삭제되었습니다.");
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + (e.message || e));
  }
}
