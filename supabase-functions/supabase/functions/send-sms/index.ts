// supabase/functions/send-sms/index.ts
//
// [신규] 교회관리시스템의 "문자 발송" 화면(js/sms.js)에서 호출.
// 선택된 교인들에게 동일한 문자를 한 번에 보내고, 결과를 sms_logs에
// 남깁니다.
//
// ⚠️ 실제로 문자를 보내려면 반드시 아래 두 가지가 먼저 되어 있어야
//    합니다 (이건 코드가 아니라 제도/계약 문제라 여기서 대신해드릴
//    수 없습니다):
//
//   1) 문자 발송 대행업체 가입 - 여기서는 국내에서 널리 쓰이는
//      알리고(https://smartsms.aligo.in)를 기본값으로 구현했습니다.
//      다른 업체(솔라피, NHN Cloud 등)를 쓰시면 아래 sendViaAligo()
//      함수만 그 업체 API 형식에 맞게 바꾸면 됩니다 - 나머지(수신자
//      조회, 로그 저장) 코드는 그대로 씁니다.
//
//   2) 발신번호 사전등록 - 정보통신망법상 문자 발신번호는 한국인터넷
//      진흥원(또는 사용하는 문자 대행업체)에 미리 등록해야만 실제
//      발송이 됩니다. 등록 안 된 번호로는 API 호출 자체가 거부됩니다.
//      (개인 휴대폰 번호도 본인 명의면 등록 가능합니다)
//
// ⚠️ 배포 전 필수 설정 (Supabase 대시보드 > Edge Functions > Secrets):
//   ALIGO_API_KEY   - 알리고 가입 후 발급받는 API 키
//   ALIGO_USER_ID   - 알리고 가입 아이디
//   ALIGO_SENDER    - 사전등록된 발신번호 (하이픈 없이, 예: 0212345678)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - 이미 기본 제공
//
// 배포: supabase functions deploy send-sms --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALIGO_API_KEY = Deno.env.get("ALIGO_API_KEY") ?? "";
const ALIGO_USER_ID = Deno.env.get("ALIGO_USER_ID") ?? "";
const ALIGO_SENDER = Deno.env.get("ALIGO_SENDER") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// EUC-KR 기준 문자 발송 바이트 계산(한글 2바이트, 그 외 1바이트) -
// 90바이트 넘으면 SMS가 아니라 LMS(장문)로 보내야 함(업체 공통 규칙)
function calcSmsBytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    bytes += ch.charCodeAt(0) > 0x007f ? 2 : 1;
  }
  return bytes;
}

async function sendViaAligo(receivers: string[], message: string) {
  const isLong = calcSmsBytes(message) > 90;
  const form = new URLSearchParams({
    key: ALIGO_API_KEY,
    user_id: ALIGO_USER_ID,
    sender: ALIGO_SENDER,
    receiver: receivers.join(","),
    msg: message,
    msg_type: isLong ? "LMS" : "SMS",
  });
  if (isLong) {
    form.set("title", "교회 안내 문자");
  }
  const res = await fetch("https://apis.aligo.in/send/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const json = await res.json();
  // 알리고 응답: result_code가 1이면 성공
  return {
    ok: json.result_code === 1 || json.result_code === "1",
    raw: json,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const { churchId, sentByEmail, parishionerIds, message } = await req.json();
    if (!churchId || !message || !Array.isArray(parishionerIds) || parishionerIds.length === 0) {
      return new Response(JSON.stringify({ error: "필수 값이 없습니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: rows, error } = await supabase
      .from("parishioners")
      .select("id, name, phone")
      .eq("church_id", churchId)
      .in("id", parishionerIds);
    if (error) throw error;

    const withPhone = (rows ?? []).filter((r) => r.phone && r.phone.trim());
    const receivers = withPhone.map((r) => r.phone.replace(/[^0-9]/g, ""));
    const names = withPhone.map((r) => r.name);

    if (receivers.length === 0) {
      await supabase.from("sms_logs").insert({
        id: crypto.randomUUID(),
        church_id: churchId,
        message,
        recipient_count: 0,
        recipient_names: [],
        status: "failed",
        provider_message: "선택된 교인 중 전화번호가 등록된 사람이 없습니다.",
        sent_by_email: sentByEmail ?? null,
      });
      return new Response(
        JSON.stringify({ ok: false, error: "선택된 교인 중 전화번호가 등록된 사람이 없습니다." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let result;
    if (!ALIGO_API_KEY || !ALIGO_USER_ID || !ALIGO_SENDER) {
      // 발송업체 설정이 안 되어 있으면 실제 API를 호출하지 않고
      // 로그만 "failed"로 남김 (설정 전에 실수로 과금/오발송되는 것 방지)
      result = {
        ok: false,
        raw: { message: "ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER 시크릿이 설정되지 않았습니다." },
      };
    } else {
      result = await sendViaAligo(receivers, message);
    }

    await supabase.from("sms_logs").insert({
      id: crypto.randomUUID(),
      church_id: churchId,
      message,
      recipient_count: receivers.length,
      recipient_names: names,
      status: result.ok ? "sent" : "failed",
      provider_message: JSON.stringify(result.raw).slice(0, 500),
      sent_by_email: sentByEmail ?? null,
    });

    return new Response(JSON.stringify({ ok: result.ok, sent: result.ok ? receivers.length : 0, detail: result.raw }), {
      status: result.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
