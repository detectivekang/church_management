-- =========================================================
-- 교회관리시스템 - 심방기록 테이블
-- =========================================================
-- parishioners(교적) 한 사람에 여러 건의 심방기록이 붙는 구조입니다
-- (1:N). 교인이 삭제되면 그 사람의 심방기록도 같이 정리되도록
-- on delete cascade로 걸어뒀습니다.
-- =========================================================

create table if not exists visitations (
  id                text primary key,
  church_id         text not null references churches(id) on delete cascade,
  parishioner_id    text not null references parishioners(id) on delete cascade,

  visit_date        text not null,             -- YYYY-MM-DD
  visit_type        text,                       -- 정기심방/특별심방/병원심방/경조사심방/신급심방 등
  location          text,                       -- 자택/병원/전화심방 등
  content           text,                       -- 심방 내용
  prayer_request    text,                       -- 기도제목

  follow_up_needed  boolean not null default false,
  follow_up_date    text,

  visitor_email     text,                       -- 심방자(보통 담당 목회자)
  visitor_name      text,

  created_at        bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by        text
);

create index if not exists visitations_church_idx on visitations (church_id);
create index if not exists visitations_parishioner_idx on visitations (parishioner_id, visit_date desc);

alter table visitations enable row level security;
drop policy if exists visitations_all on visitations;
create policy visitations_all on visitations
  for all using (true) with check (true);
