-- =========================================================
-- 교회관리시스템 - 헌금(기부금) 기록 테이블
-- =========================================================
-- parishioners 1명에 여러 건의 헌금 기록이 붙습니다(1:N).
-- 무기명 헌금(주일 강단헌금처럼 특정인 것으로 잡기 애매한 것)도
-- 있을 수 있어서 parishioner_id는 nullable로 뒀습니다 - 다만
-- "개인별 연간 헌금 통계/기부금 확인서"에는 당연히 안 잡힙니다.
-- =========================================================

create table if not exists offerings (
  id                text primary key,
  church_id         text not null references churches(id) on delete cascade,
  parishioner_id    text references parishioners(id) on delete set null,

  offering_date     text not null,             -- YYYY-MM-DD
  offering_type     text not null,             -- 십일조/주일헌금/감사헌금/선교헌금/건축헌금/절기헌금/기타
  amount            bigint not null default 0, -- 원 단위 정수
  memo              text,

  created_at        bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by        text
);

create index if not exists offerings_church_idx on offerings (church_id, offering_date desc);
create index if not exists offerings_parishioner_idx on offerings (parishioner_id, offering_date desc);

alter table offerings enable row level security;
drop policy if exists offerings_all on offerings;
create policy offerings_all on offerings
  for all using (true) with check (true);
