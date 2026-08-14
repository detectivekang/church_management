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
   문자 내용을 클립보드에 복사해서 휴대폰 문자 앱에 직접 붙여넣어
   보낼 수 있게 함. 받는 사람이 1명이면 sms: 링크도 함께 열어줌
   (모바일 브라우저에서는 문자 앱이 바로 뜸).
   --------------------------------------------------------- */
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

  if (phones.length === 1) {
    window.open(`sms:${phones[0]}?body=${encodeURIComponent(message)}`, "_blank");
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
      phones.length === 1
        ? "번호와 문자 내용이 클립보드에 복사되었고, 문자 앱이 열렸는지 확인해주세요.\n안 열렸다면 문자 앱에 직접 붙여넣어 보내주세요."
        : `번호 ${phones.length}개와 문자 내용이 클립보드에 복사되었습니다.\n휴대폰 문자 앱을 열어 받는사람란에 붙여넣고 보내주세요.`,
    );
  } else {
    await alertDialog(
      "클립보드 복사에 실패했습니다. 아래 내용을 직접 선택해 복사해주세요.\n\n" + clipboardText,
    );
  }
});

/* ---------------------------------------------------------
   발송 이력
   --------------------------------------------------------- */
let smsHistorySearchKeyword = "";

async function loadSmsHistory() {
  const snap = await churchCol("smsLogs").get();
  smsHistory = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))
    .slice(0, 100);
  renderSmsHistory();
}

function filteredSmsHistory() {
  const kw = smsHistorySearchKeyword.trim();
  if (!kw) return smsHistory.slice(0, 20);
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
  wrap.innerHTML = list
    .map((h) => {
      const date = h.sentAt ? new Date(h.sentAt).toLocaleString("ko-KR") : "";
      const statusLabel = { sent: "발송완료", failed: "발송실패", partial: "일부발송", manual: "직접발송" }[h.status] || h.status;
      const statusClass = h.status === "sent" ? "" : "danger";
      return `
        <div class="list-card" style="cursor: default">
          <div class="list-card-main">
            <div class="list-card-title">
              ${escapeHtml(date)}
              <span class="badge ${statusClass === "danger" ? "muted" : "muted"}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="list-card-sub">${h.recipientCount}명 · ${escapeHtml((h.message || "").slice(0, 40))}${(h.message || "").length > 40 ? "..." : ""}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

document.getElementById("smsHistorySearchInput").addEventListener("input", (e) => {
  smsHistorySearchKeyword = e.target.value;
  renderSmsHistory();
});
