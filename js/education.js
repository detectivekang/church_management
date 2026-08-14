/* =========================================================
   교육관리 - 확신반/성장반/여호수아 영성훈련 같은 과정을 만들고
   교인별 이수현황(수강중/이수/중도포기)을 관리합니다.
   ========================================================= */

const ENROLLMENT_STATUS_LABEL = {
  in_progress: "수강중",
  completed: "이수",
  dropped: "중도포기",
};

let educationCourses = [];
let selectedCourseId = null;
let courseEnrollments = []; // 지금 선택된 과정의 명단만 캐시
let eduPersonSearchKeyword = "";
let courseSearchKeyword = "";
let courseRosterSearchKeyword = "";

async function loadEducationCourses() {
  const snap = await churchCol("educationCourses").get();
  educationCourses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function filteredCourses() {
  const kw = courseSearchKeyword.trim();
  const list = sortByName(educationCourses);
  if (!kw) return list;
  return list.filter((c) => [c.name, c.description].filter(Boolean).join(" ").includes(kw));
}

function renderCourseList() {
  const wrap = document.getElementById("courseList");
  if (educationCourses.length === 0) {
    wrap.innerHTML = '<div class="empty">등록된 교육과정이 없습니다.</div>';
    return;
  }
  const list = filteredCourses();
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }
  wrap.innerHTML = list
    .map(
      (c) => `
      <div class="list-card ${c.id === selectedCourseId ? "selected" : ""}" data-id="${c.id}" data-act="select-course">
        <div class="list-card-main">
          <div class="list-card-title">${escapeHtml(c.name)}</div>
          <div class="list-card-sub">${escapeHtml(c.description || "")}</div>
        </div>
        <button type="button" class="visit-delete" data-id="${c.id}" data-act="delete-course">삭제</button>
      </div>
    `,
    )
    .join("");
  wrap.querySelectorAll('[data-act="select-course"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.dataset.act === "delete-course") return;
      selectCourse(el.dataset.id);
    });
  });
  wrap.querySelectorAll('[data-act="delete-course"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCourse(btn.dataset.id);
    });
  });
}

document.getElementById("courseSearchInput").addEventListener("input", (e) => {
  courseSearchKeyword = e.target.value;
  renderCourseList();
});

document.getElementById("addCourseBtn").addEventListener("click", async () => {
  const nameEl = document.getElementById("newCourseName");
  const descEl = document.getElementById("newCourseDesc");
  if (!nameEl.value.trim()) {
    nameEl.classList.add("field-error");
    return;
  }
  nameEl.classList.remove("field-error");
  try {
    await churchCol("educationCourses").add({
      name: nameEl.value.trim(),
      description: descEl.value.trim(),
      createdAt: Date.now(),
      createdBy: (currentUser && currentUser.email) || "",
    });
    nameEl.value = "";
    descEl.value = "";
    await loadEducationCourses();
    renderCourseList();
    showToast("교육과정이 등록되었습니다.");
  } catch (e) {
    await alertDialog("저장 중 오류가 발생했습니다: " + (e.message || e));
  }
});

async function deleteCourse(id) {
  const ok = await confirmDialog(
    "이 교육과정을 삭제하시겠습니까?\n등록된 이수현황도 함께 삭제됩니다.",
    "삭제",
    "취소",
  );
  if (!ok) return;
  try {
    await churchCol("educationCourses").doc(id).delete();
    if (selectedCourseId === id) {
      selectedCourseId = null;
      courseEnrollments = [];
      document.getElementById("courseRosterWrap").style.display = "none";
    }
    await loadEducationCourses();
    renderCourseList();
    showToast("삭제되었습니다.");
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* ---------------------------------------------------------
   과정 선택 -> 이수현황(명단) 관리
   --------------------------------------------------------- */
async function selectCourse(courseId) {
  selectedCourseId = courseId;
  renderCourseList();
  const course = educationCourses.find((c) => c.id === courseId);
  document.getElementById("courseRosterTitle").textContent = `"${course ? course.name : ""}" 이수현황`;
  document.getElementById("courseRosterWrap").style.display = "";
  document.getElementById("eduPersonSearch").value = "";
  document.getElementById("eduPersonResults").innerHTML = "";
  courseRosterSearchKeyword = "";
  document.getElementById("courseRosterSearchInput").value = "";
  await loadCourseEnrollments(courseId);
  renderCourseRoster();
  document.getElementById("courseRosterWrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function loadCourseEnrollments(courseId) {
  const snap = await churchCol("educationEnrollments").where("courseId", "==", courseId).get();
  courseEnrollments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function renderCourseRoster() {
  const wrap = document.getElementById("courseRosterList");
  if (courseEnrollments.length === 0) {
    wrap.innerHTML = '<div class="empty">아직 등록된 사람이 없습니다.</div>';
    return;
  }
  const kw = courseRosterSearchKeyword.trim();
  let rows = courseEnrollments
    .map((e) => ({ ...e, name: parishionerName(e.parishionerId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  if (kw) rows = rows.filter((r) => r.name.includes(kw));
  if (rows.length === 0) {
    wrap.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }

  wrap.innerHTML = rows
    .map(
      (e) => `
      <div class="list-card" style="cursor: default">
        <div class="list-card-main">
          <div class="list-card-title">${escapeHtml(e.name)}</div>
          <div class="list-card-sub">${e.completeDate ? "이수일 " + escapeHtml(e.completeDate) : ""}</div>
        </div>
        <select data-id="${e.id}" data-act="change-status" class="roster-status-select">
          <option value="in_progress" ${e.status === "in_progress" ? "selected" : ""}>수강중</option>
          <option value="completed" ${e.status === "completed" ? "selected" : ""}>이수</option>
          <option value="dropped" ${e.status === "dropped" ? "selected" : ""}>중도포기</option>
        </select>
        <button type="button" class="visit-delete" data-id="${e.id}" data-act="delete-enrollment">삭제</button>
      </div>
    `,
    )
    .join("");

  wrap.querySelectorAll('[data-act="change-status"]').forEach((sel) => {
    sel.addEventListener("change", () => updateEnrollmentStatus(sel.dataset.id, sel.value));
  });
  wrap.querySelectorAll('[data-act="delete-enrollment"]').forEach((btn) => {
    btn.addEventListener("click", () => deleteEnrollment(btn.dataset.id));
  });
}

async function updateEnrollmentStatus(enrollmentId, status) {
  const payload = { status };
  if (status === "completed") {
    payload.completeDate = todayStr();
  } else {
    payload.completeDate = "";
  }
  try {
    await churchCol("educationEnrollments").doc(enrollmentId).update(payload);
    await loadCourseEnrollments(selectedCourseId);
    renderCourseRoster();
  } catch (e) {
    await alertDialog("변경 중 오류가 발생했습니다: " + (e.message || e));
  }
}

async function deleteEnrollment(enrollmentId) {
  const ok = await confirmDialog("이 사람을 명단에서 삭제하시겠습니까?", "삭제", "취소");
  if (!ok) return;
  try {
    await churchCol("educationEnrollments").doc(enrollmentId).delete();
    await loadCourseEnrollments(selectedCourseId);
    renderCourseRoster();
    showToast("삭제되었습니다.");
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* ---------------------------------------------------------
   명단에 사람 추가 (이름 검색)
   --------------------------------------------------------- */
function renderEduPersonPicker() {
  const wrap = document.getElementById("eduPersonResults");
  const kw = eduPersonSearchKeyword.trim();
  if (!kw) {
    wrap.innerHTML = "";
    return;
  }
  const alreadyIn = new Set(courseEnrollments.map((e) => e.parishionerId));
  const matches = sortByName(parishioners.filter((p) => p.name.includes(kw) && !alreadyIn.has(p.id))).slice(0, 8);
  if (matches.length === 0) {
    wrap.innerHTML = '<div class="empty" style="padding:8px 0">일치하는 교인이 없거나 이미 등록되어 있습니다.</div>';
    return;
  }
  wrap.innerHTML = matches
    .map(
      (p) => `<div class="picker-row" data-id="${p.id}">${escapeHtml(p.name)} <span class="sms-recipient-sub">${escapeHtml(p.department || "")}</span></div>`,
    )
    .join("");
  wrap.querySelectorAll(".picker-row").forEach((row) => {
    row.addEventListener("click", () => addToCourse(row.dataset.id));
  });
}

document.getElementById("eduPersonSearch").addEventListener("input", (e) => {
  eduPersonSearchKeyword = e.target.value;
  renderEduPersonPicker();
});

document.getElementById("courseRosterSearchInput").addEventListener("input", (e) => {
  courseRosterSearchKeyword = e.target.value;
  renderCourseRoster();
});

async function addToCourse(parishionerId) {
  try {
    await churchCol("educationEnrollments").add({
      courseId: selectedCourseId,
      parishionerId,
      status: "in_progress",
      startDate: todayStr(),
      createdAt: Date.now(),
      createdBy: (currentUser && currentUser.email) || "",
    });
    document.getElementById("eduPersonSearch").value = "";
    document.getElementById("eduPersonResults").innerHTML = "";
    eduPersonSearchKeyword = "";
    await loadCourseEnrollments(selectedCourseId);
    renderCourseRoster();
    showToast("등록되었습니다.");
  } catch (e) {
    if (e.code === "23505") {
      await alertDialog("이미 이 과정에 등록된 교인입니다.");
    } else {
      await alertDialog("등록 중 오류가 발생했습니다: " + (e.message || e));
    }
  }
}
