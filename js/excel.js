/* =========================================================
   교인 상세정보 - 엑셀 다운로드 / 양식 다운로드 / 일괄 업로드
   ========================================================= */

/* 엑셀 컬럼 순서 = 교인 상세정보 표와 최대한 맞춤. label이 곧
   업로드 시 인식하는 헤더 이름이라, 다운로드 → 수정 → 업로드
   왕복이 그대로 가능합니다. */
const PARISHIONER_EXCEL_COLUMNS = [
  { key: "name", label: "이름", required: true },
  { key: "gender", label: "성별" }, // 남 / 여
  { key: "birthDate", label: "생년월일" }, // YYYY-MM-DD
  { key: "phone", label: "전화번호" },
  { key: "position", label: "직분" },
  { key: "department", label: "부서" },
  { key: "district", label: "교구" },
  { key: "cell", label: "구역/속" },
  { key: "faithLevel", label: "신급" },
  { key: "registrationDate", label: "등록일" }, // YYYY-MM-DD
  { key: "registrationRoute", label: "등록경로" },
  { key: "address", label: "주소" },
  { key: "email", label: "이메일" },
  { key: "memberStatus", label: "상태" }, // 재적 / 이명 / 장기결석 / 소천 / 제적
];

const MEMBER_STATUS_LABEL_REVERSE = Object.fromEntries(
  Object.entries(MEMBER_STATUS_LABEL).map(([k, v]) => [v, k]),
);

function downloadWorkbook(rows, sheetName, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const keyCount = rows.length ? Object.keys(rows[0]).length : 0;
  ws["!cols"] = Array.from({ length: keyCount }, () => ({ wch: 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

/* ---------------------------------------------------------
   1) 양식 다운로드 (헤더 + 예시 1행)
   --------------------------------------------------------- */
function downloadParishionerTemplate() {
  const exampleRow = {
    이름: "홍길동",
    성별: "남",
    생년월일: "1990-01-15",
    전화번호: "01012345678",
    직분: "집사",
    부서: "장년1부",
    교구: "1교구",
    "구역/속": "1구역",
    신급: "세례",
    등록일: "2024-03-10",
    등록경로: "전입",
    주소: "충남 서산시 ○○로 12",
    이메일: "example@email.com",
    상태: "재적",
  };
  downloadWorkbook([exampleRow], "교인등록양식", "교인등록_템플릿.xlsx");
}

/* ---------------------------------------------------------
   2) 현재 목록 엑셀 다운로드 (검색/필터가 적용된 상태 그대로)
   --------------------------------------------------------- */
function exportParishionersToExcel() {
  const list = filteredParishioners();
  if (list.length === 0) {
    alertDialog("다운로드할 교인이 없습니다.");
    return;
  }
  const rows = list.map((p) => {
    const row = {};
    PARISHIONER_EXCEL_COLUMNS.forEach((col) => {
      let v = p[col.key] || "";
      if (col.key === "gender") v = v === "M" ? "남" : v === "F" ? "여" : "";
      if (col.key === "memberStatus") v = MEMBER_STATUS_LABEL[v] || v || "재적";
      row[col.label] = v;
    });
    return row;
  });
  const today = todayStr();
  downloadWorkbook(rows, "교인목록", `교인목록_${today}.xlsx`);
}

/* ---------------------------------------------------------
   3) 엑셀 업로드 (일괄 등록)
   --------------------------------------------------------- */
function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsArrayBuffer(file);
  });
}

function normalizeExcelDate(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  // 엑셀에서 "2024.3.10", "2024/3/10" 등으로 넘어와도 최대한 YYYY-MM-DD로 정리
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return s;
}

function mapExcelRowToParishioner(row) {
  const data = {};
  PARISHIONER_EXCEL_COLUMNS.forEach((col) => {
    let v = row[col.label];
    if (v === undefined || v === null) v = "";
    v = typeof v === "string" ? v.trim() : v;

    if (col.key === "gender") {
      v = v === "남" || v === "M" || v === "m" ? "M" : v === "여" || v === "F" || v === "f" ? "F" : "";
    } else if (col.key === "birthDate" || col.key === "registrationDate") {
      v = normalizeExcelDate(v);
    } else if (col.key === "memberStatus") {
      v = MEMBER_STATUS_LABEL_REVERSE[v] || (v ? v : "active");
    } else {
      v = v === "" ? "" : String(v);
    }
    data[col.key] = v;
  });
  return data;
}

async function handleParishionerExcelImport(file) {
  let rawRows;
  try {
    rawRows = await readExcelFile(file);
  } catch (e) {
    alertDialog("엑셀 파일을 읽는 중 오류가 발생했습니다: " + e.message);
    return;
  }

  if (rawRows.length === 0) {
    alertDialog("엑셀 파일에 데이터가 없습니다.");
    return;
  }

  const mapped = rawRows.map(mapExcelRowToParishioner);
  const errors = [];
  mapped.forEach((row, i) => {
    if (!row.name) errors.push(`${i + 2}행: 이름이 비어있습니다.`); // +2 = 헤더행 보정
  });

  const validRows = mapped.filter((row) => row.name);

  let msg = `총 ${rawRows.length}행 중 ${validRows.length}행을 등록합니다.`;
  if (errors.length > 0) {
    msg += `\n\n건너뛰는 행 (${errors.length}개):\n` + errors.slice(0, 5).join("\n");
    if (errors.length > 5) msg += `\n외 ${errors.length - 5}건`;
  }
  msg += "\n\n※ 기존 교인과 중복인지 여부는 확인하지 않고 모두 새로 등록됩니다. 이미 등록된 사람의 정보를 수정하려면 엑셀 업로드 대신 해당 교인을 직접 편집해주세요.";

  const ok = await confirmDialog(msg, "등록", "취소");
  if (!ok) return;

  const btn = document.getElementById("parishionerExcelImportInput");
  let successCount = 0;
  let failCount = 0;
  for (const row of validRows) {
    try {
      await churchCol("parishioners").add({
        name: row.name,
        gender: row.gender || null,
        birthDate: row.birthDate || null,
        phone: row.phone || null,
        position: row.position || null,
        department: row.department || null,
        district: row.district || null,
        cell: row.cell || null,
        faithLevel: row.faithLevel || null,
        registrationDate: row.registrationDate || null,
        registrationRoute: row.registrationRoute || null,
        address: row.address || null,
        email: row.email || null,
        memberStatus: row.memberStatus || "active",
      });
      successCount += 1;
    } catch (e) {
      failCount += 1;
    }
  }

  await loadParishioners();
  renderParishionerList();
  renderHome();

  if (failCount === 0) {
    showToast(`${successCount}명 등록했습니다.`);
  } else {
    alertDialog(`${successCount}명 등록 완료, ${failCount}명은 오류로 실패했습니다.`);
  }
}

document.getElementById("parishionerExcelTemplateBtn").addEventListener("click", downloadParishionerTemplate);
document.getElementById("parishionerExcelExportBtn").addEventListener("click", exportParishionersToExcel);
document.getElementById("parishionerExcelImportInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  handleParishionerExcelImport(file).finally(() => {
    e.target.value = "";
  });
});

/* =========================================================
   다른 탭들의 엑셀 다운로드 (읽기 전용 - 업로드는 교인만 지원)
   ========================================================= */

/* ---------------------------------------------------------
   헌금 관리
   --------------------------------------------------------- */
function exportOfferingsToExcel() {
  const list = filteredOfferingList();
  if (list.length === 0) {
    alertDialog("다운로드할 헌금 기록이 없습니다.");
    return;
  }
  const rows = list.map((o) => ({
    날짜: o.offeringDate || "",
    이름: parishionerName(o.parishionerId),
    항목: o.offeringType || "",
    금액: Number(o.amount) || 0,
    메모: o.memo || "",
  }));
  downloadWorkbook(rows, "헌금기록", `헌금기록_${offeringsYear}년_${todayStr()}.xlsx`);
}

/* ---------------------------------------------------------
   교육 관리
   --------------------------------------------------------- */
function exportCoursesToExcel() {
  const list = filteredCourses();
  if (list.length === 0) {
    alertDialog("다운로드할 교육과정이 없습니다.");
    return;
  }
  const rows = list.map((c) => ({
    과정명: c.name || "",
    설명: c.description || "",
    시작일: c.startDate || "",
  }));
  downloadWorkbook(rows, "교육과정", `교육과정목록_${todayStr()}.xlsx`);
}

function exportCourseRosterToExcel() {
  if (!selectedCourseId || courseEnrollments.length === 0) {
    alertDialog("다운로드할 명단이 없습니다.");
    return;
  }
  const course = educationCourses.find((c) => c.id === selectedCourseId);
  const rows = courseEnrollments
    .map((e) => ({ ...e, name: parishionerName(e.parishionerId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map((e) => ({
      이름: e.name,
      상태: ENROLLMENT_STATUS_LABEL[e.status] || e.status || "",
      이수일: e.completeDate || "",
    }));
  downloadWorkbook(rows, "이수현황", `${course ? course.name : "교육과정"}_이수현황_${todayStr()}.xlsx`);
}

/* ---------------------------------------------------------
   조직 관리
   --------------------------------------------------------- */
function exportOrgRosterToExcel() {
  if (!selectedOrgUnitId || orgUnitMembers.length === 0) {
    alertDialog("다운로드할 명단이 없습니다.");
    return;
  }
  const unit = orgUnits.find((u) => u.id === selectedOrgUnitId);
  const rows = orgUnitMembers
    .map((m) => ({ ...m, name: parishionerName(m.parishionerId) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map((m) => ({ 이름: m.name }));
  downloadWorkbook(rows, "조직명단", `${unit ? unit.name : "조직"}_명단_${todayStr()}.xlsx`);
}

/* ---------------------------------------------------------
   가족 관리
   --------------------------------------------------------- */
function exportFamiliesToExcel() {
  const list = filteredFamilies();
  if (list.length === 0) {
    alertDialog("다운로드할 가족이 없습니다.");
    return;
  }
  const rows = list.map((f) => ({
    가족명: f.name || "",
    주소: f.address || "",
    구성원수: familyMembersOf(f.id).length,
  }));
  downloadWorkbook(rows, "가족목록", `가족목록_${todayStr()}.xlsx`);
}

function exportFamilyRosterToExcel() {
  if (!selectedFamilyId) return;
  const members = familyMembersOf(selectedFamilyId);
  if (members.length === 0) {
    alertDialog("다운로드할 구성원이 없습니다.");
    return;
  }
  const fam = families.find((f) => f.id === selectedFamilyId);
  const rows = members.map((p) => ({
    이름: p.name || "",
    관계: p.familyRole || "",
    생년월일: p.birthDate || "",
    전화번호: p.phone || "",
  }));
  downloadWorkbook(rows, "가족구성원", `${fam ? fam.name : "가족"}_구성원_${todayStr()}.xlsx`);
}

/* ---------------------------------------------------------
   행사 관리
   --------------------------------------------------------- */
function exportEventsToExcel() {
  const list = filteredEvents();
  if (list.length === 0) {
    alertDialog("다운로드할 행사가 없습니다.");
    return;
  }
  const rows = upcomingFirst(list).map((e) => ({
    행사명: e.name || "",
    날짜: e.eventDate || "",
    시간: e.startTime || "",
    장소: e.location || "",
  }));
  downloadWorkbook(rows, "행사목록", `행사목록_${todayStr()}.xlsx`);
}

function exportEventRosterToExcel() {
  if (!selectedEventId || eventParticipants.length === 0) {
    alertDialog("다운로드할 참석자가 없습니다.");
    return;
  }
  const ev = events.find((e) => e.id === selectedEventId);
  const rows = sortByName(eventParticipants, (p) => eventParticipantName(p.parishionerId)).map((p) => ({
    이름: eventParticipantName(p.parishionerId),
    참석여부: p.status || "",
  }));
  downloadWorkbook(rows, "참석자", `${ev ? ev.name : "행사"}_참석자_${todayStr()}.xlsx`);
}

/* ---------------------------------------------------------
   버튼 연결
   --------------------------------------------------------- */
function bindExcelButton(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", handler);
}

bindExcelButton("offeringExcelExportBtn", exportOfferingsToExcel);
bindExcelButton("courseExcelExportBtn", exportCoursesToExcel);
bindExcelButton("courseRosterExcelExportBtn", exportCourseRosterToExcel);
bindExcelButton("orgRosterExcelExportBtn", exportOrgRosterToExcel);
bindExcelButton("familyExcelExportBtn", exportFamiliesToExcel);
bindExcelButton("familyRosterExcelExportBtn", exportFamilyRosterToExcel);
bindExcelButton("eventExcelExportBtn", exportEventsToExcel);
bindExcelButton("eventRosterExcelExportBtn", exportEventRosterToExcel);
