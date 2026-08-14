-- =========================================================
-- 교회관리시스템 - 교육관리 (교육과정 + 이수현황)
-- =========================================================
-- 확신반/성장반/여호수아 영성훈련 같은 "교육과정"을 만들고,
-- 그 과정에 교인을 등록해서 수강중/이수/중도포기 상태를
-- 관리합니다. courses:enrollments = 1:N, parishioners:enrollments
-- 도 1:N 입니다(한 사람이 여러 과정을 들을 수 있음).
-- =========================================================

create table if not exists education_courses (
  id                text primary key,
  church_id         text not null references churches(id) on delete cascade,
  name              text not null,             -- 확신반/성장반/여호수아 영성훈련 등
  description       text,
  created_at        bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by        text
);

create table if not exists education_enrollments (
  id                text primary key,
  church_id         text not null references churches(id) on delete cascade,
  course_id         text not null references education_courses(id) on delete cascade,
  parishioner_id    text not null references parishioners(id) on delete cascade,

  status            text not null default 'in_progress', -- in_progress / completed / dropped
  start_date        text,
  complete_date     text,
  memo              text,

  created_at        bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by        text,

  unique (course_id, parishioner_id)
);

create index if not exists education_courses_church_idx on education_courses (church_id);
create index if not exists education_enrollments_church_idx on education_enrollments (church_id);
create index if not exists education_enrollments_course_idx on education_enrollments (course_id);
create index if not exists education_enrollments_parishioner_idx on education_enrollments (parishioner_id);

alter table education_courses enable row level security;
drop policy if exists education_courses_all on education_courses;
create policy education_courses_all on education_courses
  for all using (true) with check (true);

alter table education_enrollments enable row level security;
drop policy if exists education_enrollments_all on education_enrollments;
create policy education_enrollments_all on education_enrollments
  for all using (true) with check (true);
