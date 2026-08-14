-- =========================================================
-- 교회관리시스템 - 문자(SMS) 발송 이력
-- =========================================================
-- 실제 발송은 Edge Function(send-sms)이 외부 문자 발송 업체 API를
-- 호출해서 처리하고, 그 결과만 여기 남깁니다. "누구에게 언제 무슨
-- 문자를 보냈는지" 조회/감사용입니다.
-- =========================================================

create table if not exists sms_logs (
  id                 text primary key,
  church_id          text not null references churches(id) on delete cascade,
  message            text not null,
  recipient_count    integer not null default 0,
  recipient_names    text[] not null default '{}',
  status             text not null default 'sent', -- sent / failed / partial
  provider_message   text,                          -- 발송업체 응답 요약(실패 사유 등)
  sent_by_email      text,
  sent_at            bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists sms_logs_church_idx on sms_logs (church_id, sent_at desc);

alter table sms_logs enable row level security;
drop policy if exists sms_logs_all on sms_logs;
create policy sms_logs_all on sms_logs
  for all using (true) with check (true);
