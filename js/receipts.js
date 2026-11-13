/* =========================================================
   기부금영수증 발급 (소득세법 시행규칙 별지 제45호의2서식)
   - 헌금 관리 화면 맨 아래에 붙음. 운영자(admin) 전용 (교회관리시스템 자체가 운영자 전용)
   - 금액·일련번호·발급 이력은 모두 서버(DB 함수)가 처리하고, 이 파일은 화면/인쇄만 담당
       issue_donation_receipt()  발급 / 재발급(재출력)
       void_donation_receipt()   무효 처리
     (supabase-migration-donation-receipts.sql 을 먼저 적용해야 동작)
   - 기부자 주민등록번호는 서버에 보내지도, 저장하지도 않음. 출력할 때 입력받아
     영수증 인쇄물에만 넣고, 입력값은 바로 지움
   - 인쇄는 화면에 안 보이는 iframe + 브라우저 인쇄(PDF로 저장 가능)를 씀.
     안드로이드 앱(WebView)에서는 인쇄가 안 될 수 있어 PC 사용을 안내함
   ========================================================= */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DEFAULT_TYPES = OFFERING_TYPES.filter((t) => t !== "기타");
  const LEGAL_BASIS_TEXT = "「법인세법 시행령」 제39조제1항제1호마목";

  let settings = null; /* receipt_settings 행 (없으면 null) */
  let ledger = []; /* 선택 연도의 발급 대장 */
  let loadedKey = "";
  let pending = null; /* {pid, reissue} - 주민등록번호 입력을 기다리는 발급 */
  let busy = false;

  /* ---------- 공통 ---------- */
  function includedTypes() {
    return settings && Array.isArray(settings.included_types) && settings.included_types.length
      ? settings.included_types
      : DEFAULT_TYPES;
  }
  function settingsComplete() {
    return !!settings && ["org_name", "reg_no", "org_address", "representative"].every((k) => String(settings[k] || "").trim());
  }
  function fmtKDate(ms) {
    const d = new Date(Number(ms) + 9 * 3600 * 1000);
    return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  /* 700000 -> "칠십만", 21000 -> "이만일천" (영수증에 금액을 한글로도 적어주는 용도) */
  function numToKorean(n) {
    n = Math.floor(Number(n) || 0);
    if (n === 0) return "영";
    const digit = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
    const small = ["", "십", "백", "천"];
    const big = ["", "만", "억", "조"];
    const parts = [];
    let unit = 0;
    while (n > 0) {
      const chunk = n % 10000;
      n = Math.floor(n / 10000);
      if (chunk > 0) {
        let s = "";
        for (let i = 0; i < 4; i++) {
          const d = Math.floor(chunk / 10 ** i) % 10;
          if (d === 0) continue;
          s = digit[d] + small[i] + s; /* 정식 서류는 위변조 방지를 위해 "일십·일백·일천"처럼 일도 적음 */
        }
        parts.unshift(s + big[unit]);
      }
      unit++;
    }
    return parts.join("");
  }

  /* ---------- 데이터 ---------- */
  async function loadServerData(force) {
    const key = `${currentChurchId}:${offeringsYear}`;
    if (!force && key === loadedKey) return;
    loadedKey = key;
    const [s, l] = await Promise.all([
      sb.from("receipt_settings").select("*").eq("church_id", currentChurchId).maybeSingle(),
      sb.from("donation_receipts").select("*").eq("church_id", currentChurchId).eq("year", offeringsYear).order("seq", { ascending: true }),
    ]);
    if (s.error || l.error) {
      loadedKey = "";
      throw s.error || l.error;
    }
    settings = s.data || null;
    ledger = l.data || [];
  }

  /* 선택 연도 헌금 중 영수증 대상(기명 + 대상 종류 + 0원 초과)을 교인별로 합산 */
  function eligibleByDonor() {
    const types = new Set(includedTypes());
    const map = new Map();
    offerings.forEach((o) => {
      const amt = Number(o.amount) || 0;
      if (!o.parishionerId || amt <= 0 || !types.has(o.offeringType)) return;
      if (!parishioners.some((p) => p.id === o.parishionerId)) return;
      const cur = map.get(o.parishionerId) || { pid: o.parishionerId, total: 0, count: 0 };
      cur.total += amt;
      cur.count += 1;
      map.set(o.parishionerId, cur);
    });
    return Array.from(map.values());
  }

  /* ---------- 화면 ---------- */
  function renderAll() {
    const listEl = $("rcptDonorList");
    const ledgerEl = $("rcptLedger");
    if (!listEl || !ledgerEl) return;

    $("rcptSettingsWarn").style.display = settingsComplete() ? "none" : "block";
    $("rcptTypesNote").textContent = `영수증에 포함되는 헌금: ${includedTypes().join(" · ")}  (무기명 헌금은 제외)`;

    const issued = new Map(ledger.filter((r) => r.status === "issued").map((r) => [r.parishioner_id, r]));
    const rows = eligibleByDonor().map((d) => ({ ...d, rec: issued.get(d.pid) }));
    rows.sort((a, b) => (!!a.rec - !!b.rec) || b.total - a.total);
    const doneCount = rows.filter((r) => r.rec).length;
    $("rcptSummary").textContent = rows.length
      ? `${offeringsYear}년 대상 ${rows.length}명 · 발급 ${doneCount}명 · 미발급 ${rows.length - doneCount}명`
      : `${offeringsYear}년에 영수증 대상 헌금(기명)이 없습니다.`;

    listEl.innerHTML = rows
      .map((r) => {
        const changed = r.rec && Number(r.rec.total_amount) !== r.total;
        const status = r.rec
          ? `<span class="rcpt-badge done">발급됨 ${escapeHtml(r.rec.serial_no)}${r.rec.reissue_count ? ` · 재출력 ${r.rec.reissue_count}회` : ""}</span>`
          : `<span class="rcpt-badge todo">미발급</span>`;
        const warn = changed
          ? `<div class="rcpt-warn-line">⚠ 발급 후 헌금 기록이 바뀌었습니다 (발급 당시 ${fmtWon(Number(r.rec.total_amount))}). 금액이 틀렸다면 무효 처리 후 다시 발급하세요.</div>`
          : "";
        const act = r.rec
          ? `<button type="button" class="btn ghost rcpt-btn" data-rcpt-print="${r.pid}" data-reissue="1">🖨 다시 출력</button>`
          : `<button type="button" class="btn rcpt-btn" data-rcpt-print="${r.pid}">🧾 발급·출력</button>`;
        return `<div class="rcpt-row">
          <div class="rcpt-row-main">
            <div class="rcpt-name">${escapeHtml(parishionerName(r.pid))}</div>
            <div class="rcpt-meta">${r.count}건 · <b>${fmtWon(r.total)}</b></div>
            ${status}${warn}
          </div>
          <div class="rcpt-row-act">${act}</div>
        </div>`;
      })
      .join("");

    ledgerEl.innerHTML = ledger.length
      ? ledger
          .slice()
          .reverse()
          .map(
            (r) => `<div class="rcpt-ledger-row ${r.status === "voided" ? "voided" : ""}">
          <div><b>${escapeHtml(r.serial_no)}</b> · ${escapeHtml(r.donor_name)}</div>
          <div class="rcpt-meta">${fmtWon(Number(r.total_amount))} · ${fmtKDate(r.issued_at)} 발급${r.reissue_count ? ` · 재출력 ${r.reissue_count}회` : ""}${r.status === "voided" ? ` · <b>무효</b> (${escapeHtml(r.void_reason || "")})` : ""}</div>
          ${r.status === "issued" ? `<button type="button" class="rcpt-void" data-rcpt-void="${r.id}">무효 처리</button>` : ""}
        </div>`,
          )
          .join("")
      : `<div class="rcpt-empty">${offeringsYear}년에 발급한 영수증이 없습니다.</div>`;
  }

  async function refresh(force) {
    if (!$("rcptDonorList") || !currentChurchId) return;
    try {
      await loadServerData(force);
    } catch (e) {
      const missing = /relation|does not exist|PGRST205|schema cache/i.test(String(e && e.message));
      $("rcptSummary").textContent = missing
        ? "기부금영수증 기능의 서버 설정(DB 업데이트)이 아직 적용되지 않았습니다."
        : "발급 정보를 불러오지 못했습니다: " + (e.message || e);
      $("rcptDonorList").innerHTML = "";
      $("rcptLedger").innerHTML = "";
      return;
    }
    renderAll();
  }

  /* ---------- 단체 정보 설정 ---------- */
  function openSettings() {
    const c = currentChurchData || {};
    const s = settings || {};
    $("rcptOrgName").value = s.org_name || c.name || "";
    $("rcptRegNo").value = s.reg_no || "";
    $("rcptOrgAddress").value = s.org_address || c.address || "";
    $("rcptRepresentative").value = s.representative || c.pastorName || c.pastor_name || "";
    const chosen = new Set(includedTypes());
    $("rcptTypeChecks").innerHTML = OFFERING_TYPES.map(
      (t) => `<label class="rcpt-check"><input type="checkbox" value="${escapeHtml(t)}" ${chosen.has(t) ? "checked" : ""} /> ${escapeHtml(t)}</label>`,
    ).join("");
    $("rcptSettingsOverlay").style.display = "flex";
  }

  async function saveSettings() {
    const v = (id) => $(id).value.trim();
    const row = {
      church_id: currentChurchId,
      org_name: v("rcptOrgName"),
      reg_no: v("rcptRegNo"),
      org_address: v("rcptOrgAddress"),
      representative: v("rcptRepresentative"),
      included_types: Array.from($("rcptTypeChecks").querySelectorAll("input:checked")).map((i) => i.value),
      updated_at: Date.now(),
      updated_by: (typeof currentUser !== "undefined" && currentUser && currentUser.email) || null,
    };
    if (!row.org_name || !row.reg_no || !row.org_address || !row.representative) {
      alertDialog("단체명, 고유번호(사업자등록번호), 소재지, 대표자 성명을 모두 입력해주세요.");
      return;
    }
    if (row.included_types.length === 0) {
      alertDialog("영수증에 포함할 헌금 종류를 하나 이상 선택해주세요.");
      return;
    }
    const { error } = await sb.from("receipt_settings").upsert(row, { onConflict: "church_id" });
    if (error) {
      alertDialog("저장하지 못했습니다: " + error.message);
      return;
    }
    $("rcptSettingsOverlay").style.display = "none";
    showToast("저장했습니다.");
    await refresh(true);
  }

  /* ---------- 발급 / 출력 ---------- */
  function errorText(e) {
    const m = String((e && e.message) || e || "");
    if (m.includes("settings_incomplete")) return "먼저 '교회(단체) 정보 설정'을 완료해주세요.";
    if (m.includes("already_issued")) return `이미 발급된 영수증입니다 (${m.split("already_issued:")[1] || ""}). '다시 출력'을 사용하세요.`;
    if (m.includes("no_donations")) return "영수증 대상 헌금 기록이 없습니다.";
    if (m.includes("invalid_year")) return "발급할 수 없는 연도입니다.";
    if (m.includes("parishioner_not_found")) return "교인 정보를 찾을 수 없습니다.";
    if (m.includes("not_issued_yet")) return "아직 발급하지 않은 영수증입니다. 먼저 발급해주세요.";
    if (/PGRST202|Could not find the function/i.test(m)) return "기부금영수증 기능의 서버 설정(DB 업데이트)이 아직 적용되지 않았습니다.";
    if (/42501|운영자만/.test(m)) return "교회 운영자만 발급할 수 있습니다.";
    return "처리하지 못했습니다: " + m;
  }

  function openRrnModal(pid, reissue) {
    if (!settingsComplete()) {
      alertDialog("먼저 '교회(단체) 정보 설정'을 완료해주세요.");
      openSettings();
      return;
    }
    pending = { pid, reissue };
    $("rcptRrnTitle").textContent = `${parishionerName(pid)}님 ${offeringsYear}년 영수증`;
    $("rcptRrnInput").value = "";
    $("rcptRrnError").textContent = "";
    $("rcptRrnOverlay").style.display = "flex";
    $("rcptRrnInput").focus();
  }

  async function confirmIssue() {
    if (!pending || busy) return;
    const raw = $("rcptRrnInput").value.replace(/\D/g, "");
    if (raw && raw.length !== 13) {
      $("rcptRrnError").textContent = "주민등록번호는 숫자 13자리입니다. 비워두면 빈칸으로 출력됩니다.";
      return;
    }
    const rrn = raw ? `${raw.slice(0, 6)}-${raw.slice(6)}` : "";
    busy = true;
    const btn = $("rcptRrnConfirm");
    btn.disabled = true;
    try {
      const { data, error } = await sb.rpc("issue_donation_receipt", {
        p_church_id: currentChurchId,
        p_parishioner_id: pending.pid,
        p_year: offeringsYear,
        p_reissue: pending.reissue,
      });
      if (error) throw error;
      $("rcptRrnOverlay").style.display = "none";
      $("rcptRrnInput").value = ""; /* 주민등록번호는 인쇄 직후 바로 지움 */
      printHtml(buildReceiptHtml(data, rrn));
      showToast(`${data.serial_no} 영수증을 출력합니다.`);
      if (data.data_changed) {
        alertDialog("이 영수증은 발급 당시 금액 그대로 출력됩니다.\n발급 이후 헌금 기록이 바뀌었으니, 금액이 틀렸다면 '무효 처리' 후 다시 발급하세요.");
      }
      await refresh(true);
    } catch (e) {
      const msg = errorText(e);
      $("rcptRrnOverlay").style.display = "none";
      alertDialog(msg);
      if (String(e.message || "").includes("settings_incomplete")) openSettings();
      await refresh(true);
    } finally {
      pending = null;
      busy = false;
      btn.disabled = false;
    }
  }

  async function voidReceipt(id) {
    const rec = ledger.find((r) => r.id === id);
    if (!rec) return;
    const reason = window.prompt(`${rec.serial_no} (${rec.donor_name}) 영수증을 무효 처리합니다.\n무효 사유를 입력해주세요. (예: 금액 오기재)`);
    if (reason === null) return;
    if (reason.trim().length < 2) {
      alertDialog("무효 사유를 2자 이상 입력해주세요.");
      return;
    }
    const { error } = await sb.rpc("void_donation_receipt", { p_id: id, p_reason: reason.trim() });
    if (error) {
      alertDialog(errorText(error));
      return;
    }
    showToast("무효 처리했습니다. 다시 발급하면 새 일련번호가 부여됩니다.");
    await refresh(true);
  }

  /* ---------- 인쇄용 서식 ---------- */
  function buildReceiptHtml(r, rrn) {
    const e = (s) => escapeHtml(String(s == null ? "" : s));
    const items = Array.isArray(r.items) ? r.items : [];
    const dates = items.map((i) => String(i.date || "")).filter(Boolean).sort();
    const dot = (d) => d.replace(/-/g, ".");
    const period = dates.length ? `${dot(dates[0])} ~ ${dot(dates[dates.length - 1])}` : String(r.year);
    const byMonth = {};
    items.forEach((i) => {
      const m = String(i.date || "").slice(5, 7);
      byMonth[m] = byMonth[m] || { count: 0, sum: 0 };
      byMonth[m].count += 1;
      byMonth[m].sum += Number(i.amount) || 0;
    });
    const monthCell = (n) => {
      const m = byMonth[String(n).padStart(2, "0")];
      return `<td class="c mon"><div class="mh">${n}월</div>${m ? `${m.sum.toLocaleString("ko-KR")}<span class="small">원</span><div class="small">${m.count}건</div>` : "-"}</td>`;
    };
    const monthGrid = [0, 6]
      .map((start) => `<tr>${[1, 2, 3, 4, 5, 6].map((i) => monthCell(start + i)).join("")}</tr>`)
      .join("");
    const org = r.org || {};
    const issued = fmtKDate(r.issued_at).split(".");
    const issuedText = `${issued[0]}년 ${Number(issued[1])}월 ${Number(issued[2])}일`;
    const total = Number(r.total_amount) || 0;
    const rrnCell = rrn ? e(rrn) : `<span class="blank">&nbsp;</span>`;
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>기부금영수증 ${e(r.serial_no)}</title>
<style>
@page { size: A4; margin: 12mm 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR","Nanum Gothic",sans-serif; font-size: 10.5pt; color: #000; line-height: 1.45; }
table.head { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
table.head td { border: 0; padding: 0; vertical-align: bottom; }
.serial { font-size: 10pt; width: 52mm; }
h1 { margin: 0; font-size: 22pt; letter-spacing: 0.4em; text-align: center; white-space: nowrap; }
.re { font-size: 9pt; color: #444; text-align: right; width: 52mm; }
table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
th, td { border: 1px solid #000; padding: 1.8mm 2.2mm; vertical-align: middle; word-break: keep-all; }
th { background: #f0f0f0; font-weight: 700; text-align: center; width: 34mm; font-size: 10pt; white-space: nowrap; }
th.sec { width: 8mm; padding: 1mm; background: #e4e4e4; }
td.c { text-align: center; } td.r { text-align: right; }
.blank { display: inline-block; min-width: 55mm; }
.sub { font-size: 8pt; color: #333; font-weight: 400; display: block; white-space: nowrap; }
.note { font-size: 8.5pt; color: #444; margin: 0 0 3mm; }
.statement { margin: 5mm 0 3mm; }
.sign { margin: 3mm 0; }
.sign .date { text-align: center; margin: 3mm 0; letter-spacing: 0.1em; }
.sign .who { display: flex; justify-content: flex-end; gap: 8mm; align-items: baseline; padding-right: 4mm; }
.sign .who b { font-size: 12pt; }
.hr { border: 0; border-top: 1px dashed #777; margin: 6mm 0; }
.small { font-size: 8.5pt; color: #444; }
.total td { font-weight: 700; background: #fafafa; }
.months td.mon { font-size: 9.5pt; padding: 1.2mm 1mm; width: 16.6%; }
.months .mh { font-weight: 700; background: #f0f0f0; margin: -1.2mm -1mm 1mm; padding: 0.8mm 0; }
</style></head><body>
<table class="head"><tr><td class="serial">일련번호&nbsp; <b>${e(r.serial_no)}</b></td><td><h1>기부금영수증</h1></td>
<td class="re">${r.reissue_count > 0 ? `(재발급 ${r.reissue_count}회)` : "&nbsp;"}</td></tr></table>

<table>
<tr><th rowspan="2" class="sec">❶<br>기<br>부<br>자</th><th>성명(법인명)</th><td>${e(r.donor_name)}</td><th>주민등록번호<span class="sub">(사업자등록번호)</span></th><td>${rrnCell}</td></tr>
<tr><th>주소(소재지)</th><td colspan="3">${e(r.donor_address)}</td></tr>
</table>

<table>
<tr><th rowspan="3" class="sec">❷<br>기<br>부<br>금<br>단<br>체</th><th>단 체 명</th><td>${e(org.name)}</td><th>사업자등록번호<span class="sub">(고유번호)</span></th><td>${e(org.reg_no)}</td></tr>
<tr><th>소 재 지</th><td colspan="3">${e(org.address)}</td></tr>
<tr><th>기부금공제대상<span class="sub">기부금단체 근거법령</span></th><td colspan="3">${e(LEGAL_BASIS_TEXT)} <span class="small">(코드 ${e(org.legal_basis_code)})</span></td></tr>
</table>

<table>
<tr><th class="sec">❸</th><th>기부금 모집처<span class="sub">(언론기관 등)</span></th><td colspan="3" class="small">해당 없음 (기부금 단체에 직접 기부)</td></tr>
</table>

<table>
<tr><th rowspan="3" class="sec">❹<br>기<br>부<br>내<br>용</th><th style="width:16mm">코 드</th><th style="width:22mm">구 분<span class="sub">(금전 또는 현물)</span></th><th>연월일</th><th style="width:34mm">금 액</th></tr>
<tr><td class="c">${e(org.donation_code)}</td><td class="c">금전</td><td class="c">${e(period)}</td><td class="r">${total.toLocaleString("ko-KR")}원</td></tr>
<tr class="total"><td colspan="3" class="c">합계 &nbsp; 금 ${e(numToKorean(total))}원정</td><td class="r">${total.toLocaleString("ko-KR")}원</td></tr>
</table>

<p class="note">※ 기부 내역(월별) — 발급 당시 헌금 기록 기준, 전체 ${items.length}건</p>
<table class="months">${monthGrid}</table>

<div class="statement">「소득세법」 제34조, 「조세특례제한법」 제58조ㆍ제76조ㆍ제88조의4 및 「법인세법」 제24조에 따른 기부금을 위와 같이 기부하였음을 증명하여 주시기 바랍니다.</div>
<div class="sign"><div class="date">${e(issuedText)}</div>
<div class="who"><span>신청인</span><b>${e(r.donor_name)}</b><span>(서명 또는 인)</span></div></div>
<hr class="hr">
<div class="statement" style="margin-top:0">위와 같이 기부금을 기부받았음을 증명합니다.</div>
<div class="sign"><div class="date">${e(issuedText)}</div>
<div class="who"><span>기부금 수령인</span><b>${e(org.name)}</b><span>대표자 ${e(org.representative)}</span><span>(서명 또는 인)</span></div></div>
<p class="small" style="text-align:right;margin-top:8mm">210mm×297mm</p>
</body></html>`;
  }

  function printHtml(html) {
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;";
    f.srcdoc = html;
    f.onload = () => {
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } catch (e) {
        alertDialog("이 기기에서는 바로 인쇄할 수 없습니다. PC 브라우저에서 출력해주세요.");
      }
      setTimeout(() => f.remove(), 120000);
    };
    document.body.appendChild(f);
  }

  /* ---------- 발급 대장 엑셀 ---------- */
  function exportLedger() {
    if (ledger.length === 0) {
      alertDialog("다운로드할 발급 내역이 없습니다.");
      return;
    }
    const rows = ledger.map((r) => ({
      일련번호: r.serial_no,
      기부자: r.donor_name,
      주소: r.donor_address || "",
      금액: Number(r.total_amount) || 0,
      발급일: fmtKDate(r.issued_at),
      재출력횟수: r.reissue_count || 0,
      상태: r.status === "voided" ? "무효" : "유효",
      무효사유: r.void_reason || "",
      발급자: r.issued_by || "",
    }));
    downloadWorkbook(rows, "기부금영수증발급대장", `기부금영수증_발급대장_${offeringsYear}년_${todayStr()}.xlsx`);
  }

  /* ---------- 연결 ---------- */
  function bind() {
    if (!$("rcptDonorList")) return;
    $("rcptSettingsBtn").addEventListener("click", openSettings);
    $("rcptSettingsWarnBtn").addEventListener("click", openSettings);
    $("rcptSettingsCancel").addEventListener("click", () => ($("rcptSettingsOverlay").style.display = "none"));
    $("rcptSettingsSave").addEventListener("click", saveSettings);
    $("rcptRrnCancel").addEventListener("click", () => {
      $("rcptRrnInput").value = "";
      pending = null;
      $("rcptRrnOverlay").style.display = "none";
    });
    $("rcptRrnConfirm").addEventListener("click", confirmIssue);
    $("rcptRrnInput").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") confirmIssue();
    });
    $("rcptLedgerExcelBtn").addEventListener("click", exportLedger);
    $("rcptDonorList").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rcpt-print]");
      if (b) openRrnModal(b.dataset.rcptPrint, b.dataset.reissue === "1");
    });
    $("rcptLedger").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rcpt-void]");
      if (b) voidReceipt(b.dataset.rcptVoid);
    });

    /* 헌금 목록/연도가 바뀌어 "개인별 연간 합계"가 다시 그려질 때마다 같이 갱신 */
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        refresh(false);
      });
    };
    new MutationObserver(schedule).observe($("offeringSummary"), { childList: true });
    $("offeringYearSelect").addEventListener("change", schedule);
  }

  window.__rcpt = { numToKorean, buildReceiptHtml, eligibleByDonor, errorText }; /* 점검/테스트용 */
  bind();
})();
