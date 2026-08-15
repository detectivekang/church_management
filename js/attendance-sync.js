/* =========================================================
   출석부 연동 - 교회 출석부(members)에서 자동으로 넘어온 매칭
   결과를 확인하고, 동명이인 등 애매한 건은 관리자가 직접
   확정하는 화면. 실제 매칭/생성은 DB 트리거
   (supabase-migration-attendance-sync.sql)가 담당하고,
   여기서는 트리거가 "확인 필요"로 넘긴 대기열만 처리합니다.
   ========================================================= */

let memberLinkQueue = [];

async function loadMemberLinkQueue() {
  const snap = await churchCol("memberLinkQueue").where("status", "==", "pending").get();
  memberLinkQueue = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function openAttendanceSyncPanel() {
  await loadMemberLinkQueue();
  renderSyncStats();
  renderSyncQueue();
}

function renderSyncStats() {
  const linked = parishioners.filter((p) => p.linkedMemberId).length;
  const unlinked = parishioners.length - linked;
  document.getElementById("syncStatLinked").textContent = linked.toLocaleString("ko-KR") + "명";
  document.getElementById("syncStatUnlinked").textContent = unlinked.toLocaleString("ko-KR") + "명";
  document.getElementById("syncStatPending").textContent = memberLinkQueue.length.toLocaleString("ko-KR") + "건";
}

function renderSyncQueue() {
  const wrap = document.getElementById("syncQueueList");
  if (memberLinkQueue.length === 0) {
    wrap.innerHTML = '<div class="empty">확인이 필요한 연동 건이 없습니다. 👍</div>';
    return;
  }

  wrap.innerHTML = memberLinkQueue
    .map((q) => {
      const candidates = (q.candidateIds || [])
        .map((cid) => parishioners.find((p) => p.id === cid))
        .filter(Boolean);
      const candidateBtns = candidates
        .map(
          (c) => `
            <button type="button" class="btn ghost small" data-act="sync-link-existing" data-queue="${q.id}" data-member="${q.memberId}" data-parishioner="${c.id}">
              ${escapeHtml(c.name)}${c.birthDate ? ` (${escapeHtml(c.birthDate)})` : ""}${c.department ? " · " + escapeHtml(c.department) : ""}
            </button>
          `,
        )
        .join("");
      return `
        <div class="sync-queue-card">
          <div class="list-card-title">
            ${escapeHtml(q.memberName)}
            ${q.memberBirthday ? `<span class="pt-muted">(${escapeHtml(q.memberBirthday)})</span>` : ""}
          </div>
          <div class="list-card-sub">
            출석부 "${escapeHtml(q.groupName || "미배정")}" 팀에 새로 등록됨 · 이름이 같은 기존 교인 ${candidates.length}명과 매칭 후보
          </div>
          <div class="sync-queue-actions">
            ${candidateBtns}
            <button type="button" class="btn ghost small" data-act="sync-create-new" data-queue="${q.id}">+ 새 교인으로 등록</button>
            <button type="button" class="btn ghost small" data-act="sync-ignore" data-queue="${q.id}">무시</button>
          </div>
        </div>
      `;
    })
    .join("");

  wrap.querySelectorAll('[data-act="sync-link-existing"]').forEach((btn) => {
    btn.addEventListener("click", () =>
      resolveSyncLinkExisting(btn.dataset.queue, btn.dataset.member, btn.dataset.parishioner),
    );
  });
  wrap.querySelectorAll('[data-act="sync-create-new"]').forEach((btn) => {
    btn.addEventListener("click", () => resolveSyncCreateNew(btn.dataset.queue));
  });
  wrap.querySelectorAll('[data-act="sync-ignore"]').forEach((btn) => {
    btn.addEventListener("click", () => resolveSyncIgnore(btn.dataset.queue));
  });
}

async function resolveSyncLinkExisting(queueId, memberId, parishionerId) {
  const p = parishioners.find((x) => x.id === parishionerId);
  const ok = await confirmDialog(`"${p ? p.name : "선택한 교인"}"님에게 연동할까요?`);
  if (!ok) return;
  try {
    await churchCol("parishioners").doc(parishionerId).update({ linkedMemberId: memberId });
    await churchCol("memberLinkQueue").doc(queueId).update({
      status: "resolved",
      resolvedParishionerId: parishionerId,
      resolvedAt: Date.now(),
      resolvedBy: (currentUser && currentUser.email) || "",
    });
    await loadParishioners();
    renderParishionerList();
    await openAttendanceSyncPanel();
    showToast("연동했습니다.");
  } catch (e) {
    alertDialog("연동 중 오류가 발생했습니다: " + e.message);
  }
}

async function resolveSyncCreateNew(queueId) {
  const q = memberLinkQueue.find((x) => x.id === queueId);
  if (!q) return;
  const ok = await confirmDialog(`"${q.memberName}"님을 새 교인으로 등록할까요?`);
  if (!ok) return;
  try {
    const ref = await churchCol("parishioners").add({
      name: q.memberName,
      birthDate: q.memberBirthday || null,
      department: q.groupName || null,
      groupId: q.groupId || null,
      registrationRoute: "출석부 자동연동",
      memberStatus: "active",
      linkedMemberId: q.memberId,
    });
    await churchCol("memberLinkQueue").doc(queueId).update({
      status: "resolved",
      resolvedParishionerId: ref.id,
      resolvedAt: Date.now(),
      resolvedBy: (currentUser && currentUser.email) || "",
    });
    await loadParishioners();
    renderParishionerList();
    await openAttendanceSyncPanel();
    showToast("새 교인으로 등록했습니다.");
  } catch (e) {
    alertDialog("등록 중 오류가 발생했습니다: " + e.message);
  }
}

async function resolveSyncIgnore(queueId) {
  const ok = await confirmDialog("이 항목을 무시할까요? (앞으로 목록에 다시 안 나옵니다)");
  if (!ok) return;
  try {
    await churchCol("memberLinkQueue").doc(queueId).update({ status: "ignored" });
    await openAttendanceSyncPanel();
  } catch (e) {
    alertDialog("처리 중 오류가 발생했습니다: " + e.message);
  }
}

/* ---------------------------------------------------------
   교인 상세정보 모달에서 쓰는 연동 상태 해제 (parishioners.js에서 호출)
   --------------------------------------------------------- */
async function unlinkParishionerFromMember(parishionerId) {
  const ok = await confirmDialog("출석부 연동을 해제할까요? (교인 정보 자체는 지워지지 않습니다)");
  if (!ok) return false;
  try {
    await churchCol("parishioners").doc(parishionerId).update({ linkedMemberId: null });
    await loadParishioners();
    renderParishionerList();
    showToast("연동을 해제했습니다.");
    return true;
  } catch (e) {
    alertDialog("처리 중 오류가 발생했습니다: " + e.message);
    return false;
  }
}
