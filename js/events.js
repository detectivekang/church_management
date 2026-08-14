/* =========================================================
   행사관리 - 행사(수련회/체육대회/봉사활동 등) 등록 + 참석여부 관리
   families.js(목록→선택→구성원 관리 구조)와 offerings.js(날짜 입력)를
   그대로 따릅니다.
   ========================================================= */

let events = [];
let selectedEventId = null;
let eventParticipants = []; // 지금 선택된 행사의 참석자 캐시만 들고 있음
let eventSearchKeyword = "";
let eventRosterSearchKeyword = "";

const EVENT_PARTICIPANT_STATUS_OPTIONS = ["참석", "불참", "미정"];

document.getElementById("newEventDate").value = todayStr();

async function loadEvents() {
  const snap = await churchCol("events").get();
  events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function upcomingFirst(list) {
  // 오늘 이후(가까운 순) 먼저, 지난 행사는 최근 지난 순으로 그 아래에
  const today = todayStr();
  const upcoming = list.filter((e) => e.eventDate >= today).sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  const past = list.filter((e) => e.eventDate < today).sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  return [...upcoming, ...past];
}

function fmtEventDate(e) {
  return e.eventDate + (e.startTime ? " " + e.startTime : "");
}

function filteredEvents() {
  const kw = eventSearchKeyword.trim();
  if (!kw) return events;
  return events.filter((e) => [e.name, e.location].filter(Boolean).join(" ").includes(kw));
}

function renderEventList() {
  const wrap = document.getElementById("eventList");
  if (events.length === 0) {
    wrap.innerHTML = '<div class="empty">등록된 행사가 없습니다.</div>';
    return;
  }
  const list = filteredEvents();
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }
  const today = todayStr();
  wrap.innerHTML = upcomingFirst(list)
    .map((e) => {
      const isPast = e.eventDate < today;
      return `
        <div class="list-card ${e.id === selectedEventId ? "selected" : ""}" data-id="${e.id}" data-act="select-event">
          <div class="list-card-main">
            <div class="list-card-title">${escapeHtml(e.name)}${isPast ? ' <span class="sms-recipient-sub">(지난 행사)</span>' : ""}</div>
            <div class="list-card-sub">${escapeHtml(fmtEventDate(e))}${e.location ? " · " + escapeHtml(e.location) : ""}</div>
          </div>
          <button type="button" class="visit-delete" data-id="${e.id}" data-act="delete-event">삭제</button>
        </div>
      `;
    })
    .join("");
  wrap.querySelectorAll('[data-act="select-event"]').forEach((el) => {
    el.addEventListener("click", (ev) => {
      if (ev.target.dataset.act === "delete-event") return;
      selectEvent(el.dataset.id);
    });
  });
  wrap.querySelectorAll('[data-act="delete-event"]').forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deleteEvent(btn.dataset.id);
    });
  });
}

document.getElementById("eventSearchInput").addEventListener("input", (e) => {
  eventSearchKeyword = e.target.value;
  renderEventList();
});

document.getElementById("addEventBtn").addEventListener("click", async () => {
  const nameEl = document.getElementById("newEventName");
  const dateEl = document.getElementById("newEventDate");
  const timeEl = document.getElementById("newEventTime");
  const locEl = document.getElementById("newEventLocation");
  const descEl = document.getElementById("newEventDescription");
  const ok = markRequired([nameEl, dateEl]);
  if (!ok) return;
  try {
    await churchCol("events").add({
      name: nameEl.value.trim(),
      eventDate: dateEl.value,
      startTime: timeEl.value.trim(),
      location: locEl.value.trim(),
      description: descEl.value.trim(),
      createdAt: Date.now(),
      createdBy: (currentUser && currentUser.email) || "",
    });
    nameEl.value = "";
    timeEl.value = "";
    locEl.value = "";
    descEl.value = "";
    dateEl.value = todayStr();
    await loadEvents();
    renderEventList();
    showToast("행사가 등록되었습니다.");
  } catch (e) {
    await alertDialog("저장 중 오류가 발생했습니다: " + (e.message || e));
  }
});

async function deleteEvent(id) {
  const ok = await confirmDialog(
    "이 행사를 삭제하시겠습니까?\n참석여부 기록도 함께 삭제됩니다(교인 정보 자체는 삭제되지 않습니다).",
    "삭제",
    "취소",
  );
  if (!ok) return;
  try {
    await churchCol("events").doc(id).delete();
    if (selectedEventId === id) {
      selectedEventId = null;
      document.getElementById("eventRosterWrap").style.display = "none";
    }
    await loadEvents();
    renderEventList();
    showToast("삭제되었습니다.");
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* ---------------------------------------------------------
   행사 선택 -> 참석자 관리
   --------------------------------------------------------- */
async function selectEvent(eventId) {
  selectedEventId = eventId;
  renderEventList();
  const event = events.find((e) => e.id === eventId);
  document.getElementById("eventRosterTitle").textContent = `"${event ? event.name : ""}" 참석자`;
  document.getElementById("eventRosterWrap").style.display = "";
  document.getElementById("eventParticipantSearch").value = "";
  document.getElementById("eventParticipantResults").innerHTML = "";
  eventRosterSearchKeyword = "";
  document.getElementById("eventRosterSearchInput").value = "";
  await loadEventParticipants();
  renderEventRoster();
  document.getElementById("eventRosterWrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function loadEventParticipants() {
  const snap = await churchCol("eventParticipants").get();
  eventParticipants = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.eventId === selectedEventId);
}

function eventParticipantName(parishionerId) {
  const p = parishioners.find((x) => x.id === parishionerId);
  return p ? p.name : "(삭제된 교인)";
}

function renderEventRoster() {
  const wrap = document.getElementById("eventRosterList");
  if (eventParticipants.length === 0) {
    wrap.innerHTML = '<div class="empty">아직 등록된 참석자가 없습니다.</div>';
    return;
  }
  const kw = eventRosterSearchKeyword.trim();
  let rows = sortByName(eventParticipants, (p) => eventParticipantName(p.parishionerId));
  if (kw) rows = rows.filter((p) => eventParticipantName(p.parishionerId).includes(kw));
  if (rows.length === 0) {
    wrap.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }
  const statusOpts = (current) =>
    EVENT_PARTICIPANT_STATUS_OPTIONS.map(
      (s) => `<option value="${s}" ${s === current ? "selected" : ""}>${s}</option>`,
    ).join("");
  wrap.innerHTML = rows
    .map(
      (p) => `
      <div class="list-card" style="cursor: default">
        <div class="list-card-main">
          <div class="list-card-title">${escapeHtml(eventParticipantName(p.parishionerId))}</div>
        </div>
        <select data-id="${p.id}" data-act="change-participant-status" class="roster-status-select">
          ${statusOpts(p.status)}
        </select>
        <button type="button" class="visit-delete" data-id="${p.id}" data-act="remove-participant">제외</button>
      </div>
    `,
    )
    .join("");
  wrap.querySelectorAll('[data-act="change-participant-status"]').forEach((sel) => {
    sel.addEventListener("change", () => updateParticipantStatus(sel.dataset.id, sel.value));
  });
  wrap.querySelectorAll('[data-act="remove-participant"]').forEach((btn) => {
    btn.addEventListener("click", () => removeParticipant(btn.dataset.id));
  });
}

document.getElementById("eventRosterSearchInput").addEventListener("input", (e) => {
  eventRosterSearchKeyword = e.target.value;
  renderEventRoster();
});

async function updateParticipantStatus(participantRowId, status) {
  try {
    await churchCol("eventParticipants").doc(participantRowId).update({ status });
    await loadEventParticipants();
    renderEventRoster();
  } catch (e) {
    await alertDialog("변경 중 오류가 발생했습니다: " + (e.message || e));
  }
}

async function removeParticipant(participantRowId) {
  const ok = await confirmDialog("이 사람을 참석자 명단에서 제외하시겠습니까?", "제외", "취소");
  if (!ok) return;
  try {
    await churchCol("eventParticipants").doc(participantRowId).delete();
    await loadEventParticipants();
    renderEventRoster();
    showToast("제외되었습니다.");
  } catch (e) {
    await alertDialog("처리 중 오류가 발생했습니다: " + (e.message || e));
  }
}

/* ---------------------------------------------------------
   참석자 추가 (이름 검색) - 이미 등록돼 있으면 검색 결과에서 제외
   --------------------------------------------------------- */
document.getElementById("eventParticipantSearch").addEventListener("input", (e) => {
  const wrap = document.getElementById("eventParticipantResults");
  const kw = e.target.value.trim();
  if (!kw) {
    wrap.innerHTML = "";
    return;
  }
  const alreadyIds = new Set(eventParticipants.map((p) => p.parishionerId));
  const matches = sortByName(
    parishioners.filter((p) => p.name.includes(kw) && !alreadyIds.has(p.id)),
  ).slice(0, 8);
  if (matches.length === 0) {
    wrap.innerHTML = '<div class="empty" style="padding:8px 0">일치하는 교인이 없습니다.</div>';
    return;
  }
  wrap.innerHTML = matches
    .map((p) => `<div class="picker-row" data-id="${p.id}">${escapeHtml(p.name)}</div>`)
    .join("");
  wrap.querySelectorAll(".picker-row").forEach((row) => {
    row.addEventListener("click", () => addParticipant(row.dataset.id));
  });
});

async function addParticipant(parishionerId) {
  try {
    await churchCol("eventParticipants").add({
      eventId: selectedEventId,
      parishionerId,
      status: "미정",
      createdAt: Date.now(),
      createdBy: (currentUser && currentUser.email) || "",
    });
    document.getElementById("eventParticipantSearch").value = "";
    document.getElementById("eventParticipantResults").innerHTML = "";
    await loadEventParticipants();
    renderEventRoster();
    showToast("등록되었습니다.");
  } catch (e) {
    // 이미 등록된 사람을 검색창에 남아있던 결과 클릭 등으로 중복 추가하면
    // unique(event_id, parishioner_id) 제약에 걸림 - 조용히 무시하지 않고 안내
    if (e.message && e.message.includes("duplicate")) {
      await alertDialog("이미 참석자 명단에 있는 사람입니다.");
    } else {
      await alertDialog("등록 중 오류가 발생했습니다: " + (e.message || e));
    }
  }
}
