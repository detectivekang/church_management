-- =========================================================
-- 교회관리시스템 - 행사관리
-- =========================================================
-- 행사(수련회/체육대회/봉사활동 등) 자체는 events에, "누가 참석/불참/
-- 미정인지"는 org_unit_members와 같은 이유로 다대다(N:M) 조인
-- 테이블(event_participants)로 분리했습니다 - 한 사람이 여러 행사에,
-- 한 행사에 여러 사람이 걸쳐 있을 수 있기 때문입니다.
-- =========================================================

create table if not exists events (
  id           text primary key,
  church_id    text not null references churches(id) on delete cascade,
  name         text not null,             -- 예: "여름 수련회"
  event_date   text not null,             -- YYYY-MM-DD
  start_time   text,                      -- 예: "14:00" (선택)
  location     text,
  description  text,
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by   text
);

create table if not exists event_participants (
  id             text primary key,
  church_id      text not null references churches(id) on delete cascade,
  event_id       text not null references events(id) on delete cascade,
  parishioner_id text not null references parishioners(id) on delete cascade,
  status         text not null default '미정',  -- 참석 / 불참 / 미정
  memo           text,
  created_at     bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by     text,
  unique (event_id, parishioner_id)
);

create index if not exists events_church_idx on events (church_id);
create index if not exists events_date_idx on events (event_date);
create index if not exists event_participants_church_idx on event_participants (church_id);
create index if not exists event_participants_event_idx on event_participants (event_id);
create index if not exists event_participants_parishioner_idx on event_participants (parishioner_id);

alter table events enable row level security;
drop policy if exists events_all on events;
create policy events_all on events
  for all using (true) with check (true);

alter table event_participants enable row level security;
drop policy if exists event_participants_all on event_participants;
create policy event_participants_all on event_participants
  for all using (true) with check (true);
