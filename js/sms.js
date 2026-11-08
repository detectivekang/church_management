/* =========================================================
   문자(SMS) 발송
   - 실제 발송은 Edge Function(send-sms)이 처리합니다. 여기서는
     수신자 선택 + 발송 요청 + 이력 조회만 합니다.
   ========================================================= */

document.querySelectorAll(".app-nav-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchMainPanel(btn.dataset.nav));
});

document.querySelectorAll(".home-quick-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchMainPanel(btn.dataset.nav));
});

function switchMainPanel(panel) {
  document.querySelectorAll(".app-nav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === panel);
  });
  document.getElementById("homePanel").style.display = panel === "home" ? "" : "none";
  document.getElementById("parishionersPanel").style.display = panel === "parishioners" ? "" : "none";
  document.getElementById("smsPanel").style.display = panel === "sms" ? "" : "none";
  document.getElementById("offeringsPanel").style.display = panel === "offerings" ? "" : "none";
  document.getElementById("educationPanel").style.display = panel === "education" ? "" : "none";
  document.getElementById("orgPanel").style.display = panel === "org" ? "" : "none";
  document.getElementById("familiesPanel").style.display = panel === "families" ? "" : "none";
  document.getElementById("eventsPanel").style.display = panel === "events" ? "" : "none";
  document.getElementById("syncPanel").style.display = panel === "sync" ? "" : "none";
  if (panel === "home") {
    renderHome();
  } else if (panel === "sms") {
    renderSmsRecipientList();
    loadSmsHistory();
  } else if (panel === "offerings") {
    (async () => {
      if (offerings.length === 0) await loadOfferings();
      renderOfferingList();
      renderOfferingSummary();
      renderOfferingStats();
    })();
  } else if (panel === "education") {
    (async () => {
      if (educationCourses.length === 0) await loadEducationCourses();
      renderCourseList();
    })();
  } else if (panel === "org") {
    (async () => {
      if (orgUnits.length === 0) await loadOrgUnits();
      renderOrgTree();
    })();
  } else if (panel === "families") {
    (async () => {
      if (families.length === 0) await loadFamilies();
      renderFamilyList();
    })();
  } else if (panel === "events") {
    (async () => {
      if (events.length === 0) await loadEvents();
      renderEventList();
    })();
  } else if (panel === "sync") {
    openAttendanceSyncPanel();
  }
}

function smsEligibleParishioners() {
  // 문자는 재적 중인 사람에게만 (이명/제적/소천된 분께 안내문자가 나가는 걸 방지)
  return parishioners.filter((p) => (p.memberStatus || "active") === "active" && p.phone);
}

function filteredSmsRecipients() {
  const kw = smsRecipientSearchKeyword.trim();
  const base = smsEligibleParishioners();
  if (!kw) return sortByName(base);
  return sortByName(
    base.filter((p) => [p.name, p.department, p.cell].filter(Boolean).join(" ").includes(kw)),
  );
}

function renderSmsRecipientList() {
  const wrap = document.getElementById("smsRecipientList");
  const list = filteredSmsRecipients();
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">전화번호가 등록된 재적 교인이 없습니다.</div>';
  } else {
    wrap.innerHTML = list
      .map((p) => {
        const checked = smsSelectedIds.has(p.id) ? "checked" : "";
        const sub = [p.department, p.cell, p.phone].filter(Boolean).join(" · ");
        return `
          <label class="sms-recipient-row">
            <input type="checkbox" data-id="${p.id}" ${checked} />
            <span>
              <strong>${escapeHtml(p.name)}</strong>
              <span class="sms-recipient-sub">${escapeHtml(sub)}</span>
            </span>
          </label>
        `;
      })
      .join("");
    wrap.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) smsSelectedIds.add(cb.dataset.id);
        else smsSelectedIds.delete(cb.dataset.id);
        updateSmsSelectedCount();
      });
    });
  }
  updateSmsSelectedCount();
}

function updateSmsSelectedCount() {
  document.getElementById("smsSelectedCount").textContent = `${smsSelectedIds.size}명 선택됨`;
}

document.getElementById("smsRecipientSearch").addEventListener("input", (e) => {
  smsRecipientSearchKeyword = e.target.value;
  renderSmsRecipientList();
});

document.querySelectorAll("[data-quick]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const kind = btn.dataset.quick;
    if (kind === "clear") {
      smsSelectedIds.clear();
    } else if (kind === "all") {
      smsEligibleParishioners().forEach((p) => smsSelectedIds.add(p.id));
    } else if (kind === "birthday") {
      const thisMonth = String(new Date().getMonth() + 1).padStart(2, "0");
      smsEligibleParishioners()
        .filter((p) => p.birthDate && p.birthDate.split("-")[1] === thisMonth)
        .forEach((p) => smsSelectedIds.add(p.id));
    } else if (kind === "followup") {
      if (followUpNeededParishionerIds.size === 0) {
        await loadFollowUpNeededParishionerIds();
      }
      smsEligibleParishioners()
        .filter((p) => followUpNeededParishionerIds.has(p.id))
        .forEach((p) => smsSelectedIds.add(p.id));
    }
    renderSmsRecipientList();
  });
});

async function loadFollowUpNeededParishionerIds() {
  const snap = await churchCol("visitations").where("followUpNeeded", "==", true).get();
  followUpNeededParishionerIds = new Set(snap.docs.map((d) => d.data().parishionerId));
}

/* ---------------------------------------------------------
   문자 내용 / 발송
   --------------------------------------------------------- */
function calcSmsBytesClient(text) {
  let bytes = 0;
  for (const ch of text) {
    bytes += ch.charCodeAt(0) > 0x007f ? 2 : 1;
  }
  return bytes;
}

document.getElementById("smsMessage").addEventListener("input", (e) => {
  const bytes = calcSmsBytesClient(e.target.value);
  const el = document.getElementById("smsByteCount");
  if (bytes <= 90) {
    el.textContent = `${bytes} / 90바이트 (단문 SMS)`;
    el.style.color = "";
  } else {
    el.textContent = `${bytes}바이트 - 90바이트를 넘어 장문(LMS)으로 발송됩니다.`;
    el.style.color = "#c0392b";
  }
});

document.getElementById("sendSmsBtn").addEventListener("click", async () => {
  const messageEl = document.getElementById("smsMessage");
  const message = messageEl.value.trim();
  if (smsSelectedIds.size === 0) {
    await alertDialog("받는 사람을 먼저 선택해주세요.");
    return;
  }
  if (!message) {
    await alertDialog("문자 내용을 입력해주세요.");
    messageEl.focus();
    return;
  }
  const ok = await confirmDialog(`${smsSelectedIds.size}명에게 문자를 발송하시겠습니까?`, "발송", "취소");
  if (!ok) return;

  const btn = document.getElementById("sendSmsBtn");
  btn.disabled = true;
  btn.textContent = "발송 중...";
  try {
    const { data, error } = await sb.functions.invoke("send-sms", {
      body: {
        churchId: currentChurchId,
        sentByEmail: (currentUser && currentUser.email) || "",
        parishionerIds: Array.from(smsSelectedIds),
        message,
      },
    });
    if (error) throw error;
    if (!data || data.ok === false) {
      const detail = data && data.detail && data.detail.message ? data.detail.message : "";
      await alertDialog("발송에 실패했습니다.\n" + detail);
    } else {
      showToast(`${data.sent}명에게 발송되었습니다.`);
      messageEl.value = "";
      document.getElementById("smsByteCount").textContent = "";
      smsSelectedIds.clear();
      renderSmsRecipientList();
    }
  } catch (e) {
    /* "Failed to send a request to the Edge Function"은 send-sms 함수
       코드가 실행되다 실패한 게 아니라, 그 함수 자체를 아직 호출할 수
       없다는 뜻(대부분 Edge Function이 아직 배포되지 않은 경우)이라
       원인을 구분해서 안내함 */
    const raw = (e && e.message) || String(e);
    const looksUndeployed = /Failed to send a request to the Edge Function|Failed to fetch/i.test(raw);
    if (looksUndeployed) {
      await alertDialog(
        "문자 발송 기능(Edge Function)이 아직 배포되지 않은 것 같습니다.\n" +
          "supabase-functions 폴더의 send-sms를 Supabase 프로젝트에 배포하고, 문자 대행업체 키를 설정해야 자동 발송이 가능합니다.\n\n" +
          "그 전까지는 아래 \"무료로 직접 보내기\" 버튼으로 번호와 내용을 복사해 직접 문자를 보낼 수 있습니다.",
      );
    } else {
      await alertDialog("발송 중 오류가 발생했습니다: " + raw);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "문자 발송 (자동)";
    await loadSmsHistory();
  }
});

/* ---------------------------------------------------------
   무료로 직접 보내기 - 대행업체 없이, 선택된 사람들의 번호와
   문자 내용을 클립보드에 복사하고, 휴대폰이면 문자 앱을 바로 열어줌.
   받는 사람이 여러 명이어도 sms: 링크에 모든 번호를 넣어서 열어줌
   (iOS와 안드로이드는 다중 수신자 링크 형식이 달라서 구분함).
   --------------------------------------------------------- */
function isIosDevice() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isMobileDevice() {
  return isIosDevice() || /Android/i.test(navigator.userAgent || "");
}

function buildSmsLink(phones, message) {
  const body = encodeURIComponent(message);
  if (isIosDevice()) {
    // iOS: 여러 명이면 sms:/open?addresses=번호1,번호2&body=... 형식이어야 함
    return `sms:/open?addresses=${phones.join(",")}&body=${body}`;
  }
  // 안드로이드: sms:번호1,번호2?body=...
  return `sms:${phones.join(",")}?body=${body}`;
}

document.getElementById("manualSmsBtn").addEventListener("click", async () => {
  const messageEl = document.getElementById("smsMessage");
  const message = messageEl.value.trim();
  if (smsSelectedIds.size === 0) {
    await alertDialog("받는 사람을 먼저 선택해주세요.");
    return;
  }
  if (!message) {
    await alertDialog("문자 내용을 입력해주세요.");
    messageEl.focus();
    return;
  }

  const recipients = smsEligibleParishioners().filter((p) => smsSelectedIds.has(p.id));
  const phones = recipients.map((p) => p.phone.replace(/[^0-9]/g, "")).filter(Boolean);
  if (phones.length === 0) {
    await alertDialog("선택된 사람 중 전화번호가 등록된 사람이 없습니다.");
    return;
  }

  const clipboardText = `받는사람(${phones.length}명): ${phones.join(", ")}\n\n문자내용:\n${message}`;
  let copied = false;
  try {
    await navigator.clipboard.writeText(clipboardText);
    copied = true;
  } catch (e) {
    copied = false;
  }

  // 모바일이면 1명이든 여러 명이든 문자 앱을 열어줌
  // (window.open은 await 뒤에서 팝업으로 차단될 수 있어 location.href 사용)
  let smsOpened = false;
  if (isMobileDevice()) {
    window.location.href = buildSmsLink(phones, message);
    smsOpened = true;
  }

  try {
    await churchCol("smsLogs").add({
      message,
      recipientCount: recipients.length,
      recipientNames: recipients.map((p) => p.name),
      status: "manual",
      providerMessage: "관리자가 대행업체 없이 직접 문자 앱으로 발송(번호·내용 복사)",
      sentByEmail: (currentUser && currentUser.email) || "",
      sentAt: Date.now(),
    });
    await loadSmsHistory();
  } catch (e) {
    /* 이력 저장은 실패해도 복사 자체는 이미 됐으니 발송 흐름을 막지 않음 */
  }

  if (copied) {
    await alertDialog(
      smsOpened
        ? `문자 앱이 열렸는지 확인해주세요. (받는 사람 ${phones.length}명, 내용 자동 입력)\n받는 사람이 다 안 들어갔거나 앱이 안 열렸다면, 번호와 내용이 클립보드에 복사되어 있으니 문자 앱에 붙여넣어 보내주세요.`
        : `번호 ${phones.length}개와 문자 내용이 클립보드에 복사되었습니다.\n휴대폰 문자 앱을 열어 받는사람란에 붙여넣고 보내주세요.`,
    );
  } else {
    await alertDialog(
      "클립보드 복사에 실패했습니다. 아래 내용을 직접 선택해 복사해주세요.\n\n" + clipboardText,
    );
  }
});

/* ---------------------------------------------------------
   발송 이력 - 검색 + 페이지 나누기 + 개별 삭제
   --------------------------------------------------------- */
let smsHistorySearchKeyword = "";
let smsHistoryPage = 1;
const smsHistoryExpanded = new Set();
const SMS_HISTORY_PAGE_SIZE = 5;

async function loadSmsHistory() {
  const snap = await churchCol("smsLogs").get();
  smsHistory = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))
    .slice(0, 200);
  renderSmsHistory();
}

function filteredSmsHistory() {
  const kw = smsHistorySearchKeyword.trim();
  if (!kw) return smsHistory;
  return smsHistory.filter((h) =>
    [h.message, ...(h.recipientNames || [])].filter(Boolean).join(" ").includes(kw),
  );
}

function renderSmsHistory() {
  const wrap = document.getElementById("smsHistoryList");
  if (smsHistory.length === 0) {
    wrap.innerHTML = '<div class="empty">발송 이력이 없습니다.</div>';
    return;
  }
  const list = filteredSmsHistory();
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(list.length / SMS_HISTORY_PAGE_SIZE));
  if (smsHistoryPage > totalPages) smsHistoryPage = totalPages;
  if (smsHistoryPage < 1) smsHistoryPage = 1;
  const pageItems = list.slice(
    (smsHistoryPage - 1) * SMS_HISTORY_PAGE_SIZE,
    smsHistoryPage * SMS_HISTORY_PAGE_SIZE,
  );

  const statusMap = { sent: "발송완료", failed: "발송실패", partial: "일부발송", manual: "직접발송" };
  const rows = pageItems
    .map((h) => {
      const date = h.sentAt ? new Date(h.sentAt).toLocaleString("ko-KR") : "";
      const statusLabel = statusMap[h.status] || h.status;
      const names = h.recipientNames || [];
      const nameText =
        names.length === 0
          ? `${h.recipientCount}명`
          : names.length <= 3
            ? names.join(", ")
            : `${names.slice(0, 3).join(", ")} 외 ${names.length - 3}명`;
      const msg = h.message || "";
      const open = smsHistoryExpanded.has(h.id);
      let detail = "";
      if (open) {
        const showProvider = h.providerMessage && h.status !== "sent";
        detail = `
          <div class="sms-history-detail">
            <div class="sms-history-detail-label">받는 사람 (${h.recipientCount}명)</div>
            <div class="sms-history-detail-names">${names.length ? names.map((n) => `<span class="sms-history-chip">${escapeHtml(n)}</span>`).join("") : "이름 정보가 없습니다."}</div>
            <div class="sms-history-detail-label">문자 내용</div>
            <div class="sms-history-detail-msg">${escapeHtml(msg)}</div>
            ${h.sentByEmail ? `<div class="sms-history-detail-label">보낸 사람</div><div>${escapeHtml(h.sentByEmail)}</div>` : ""}
            ${showProvider ? `<div class="sms-history-detail-label">비고</div><div>${escapeHtml(h.providerMessage)}</div>` : ""}
          </div>`;
      }
      return `
        <div class="list-card sms-history-card" data-id="${h.id}" style="cursor: pointer; flex-wrap: wrap">
          <div class="list-card-main">
            <div class="list-card-title">
              ${escapeHtml(date)}
              <span class="badge muted">${escapeHtml(statusLabel)}</span>
              <span class="sms-history-toggle">${open ? "▴" : "▾"}</span>
            </div>
            <div class="list-card-sub">${escapeHtml(nameText)} · ${escapeHtml(msg.slice(0, 40))}${msg.length > 40 ? "..." : ""}</div>
          </div>
          <button type="button" class="visit-delete" data-id="${h.id}" data-act="delete-sms-log" title="이력 삭제">✕</button>
          ${detail}
        </div>
      `;
    })
    .join("");

  const pager =
    totalPages > 1
      ? `
        <div class="sms-history-pager">
          <button type="button" class="btn ghost small" data-act="sms-history-prev" ${smsHistoryPage <= 1 ? "disabled" : ""}>‹ 이전</button>
          <span>${smsHistoryPage} / ${totalPages} 페이지 (총 ${list.length}건)</span>
          <button type="button" class="btn ghost small" data-act="sms-history-next" ${smsHistoryPage >= totalPages ? "disabled" : ""}>다음 ›</button>
        </div>`
      : `<div class="list-count">총 ${list.length}건</div>`;

  wrap.innerHTML = rows + pager;
}

async function deleteSmsLog(id) {
  const ok = await confirmDialog("이 발송 이력을 삭제할까요?", "삭제", "취소");
  if (!ok) return;
  try {
    await churchCol("smsLogs").doc(id).delete();
    smsHistory = smsHistory.filter((h) => h.id !== id);
    renderSmsHistory();
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + e.message);
  }
}

document.getElementById("smsHistoryList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) {
    // 카드를 누르면 상세(받는 사람 전체 + 문자 전체 내용) 펼치기/접기
    const card = e.target.closest(".sms-history-card");
    if (card && !e.target.closest(".sms-history-detail")) {
      const id = card.dataset.id;
      if (smsHistoryExpanded.has(id)) smsHistoryExpanded.delete(id);
      else smsHistoryExpanded.add(id);
      renderSmsHistory();
    }
    return;
  }
  if (btn.disabled) return;
  const act = btn.dataset.act;
  if (act === "delete-sms-log") {
    deleteSmsLog(btn.dataset.id);
  } else if (act === "sms-history-prev") {
    smsHistoryPage -= 1;
    renderSmsHistory();
  } else if (act === "sms-history-next") {
    smsHistoryPage += 1;
    renderSmsHistory();
  }
});

document.getElementById("smsHistorySearchInput").addEventListener("input", (e) => {
  smsHistorySearchKeyword = e.target.value;
  smsHistoryPage = 1;
  renderSmsHistory();
});

/* 이력 일괄 삭제 - 오래된 이력 정리 / 전체 삭제 */
async function deleteSmsLogsBulk(targets, label) {
  if (targets.length === 0) {
    await alertDialog("삭제할 이력이 없습니다.");
    return;
  }
  const ok = await confirmDialog(`${label} ${targets.length}건을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`, "삭제", "취소");
  if (!ok) return;
  try {
    const results = await Promise.allSettled(targets.map((h) => churchCol("smsLogs").doc(h.id).delete()));
    const failed = results.filter((r) => r.status === "rejected").length;
    await loadSmsHistory();
    if (failed > 0) {
      await alertDialog(`${targets.length - failed}건 삭제, ${failed}건은 삭제에 실패했습니다.`);
    } else {
      showToast(`${targets.length}건 삭제되었습니다.`);
    }
  } catch (e) {
    await alertDialog("삭제 중 오류가 발생했습니다: " + e.message);
  }
}

document.getElementById("smsHistoryCleanupBtn").addEventListener("click", () => {
  const months = Number(document.getElementById("smsHistoryCleanupSelect").value);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const targets = smsHistory.filter((h) => (h.sentAt || 0) < cutoff.getTime());
  deleteSmsLogsBulk(targets, `${months === 12 ? "1년" : months + "개월"} 이전 이력`);
});

document.getElementById("smsHistoryClearAllBtn").addEventListener("click", () => {
  deleteSmsLogsBulk(smsHistory.slice(), "발송 이력 전체");
});
