-- =========================================================
-- 교회관리시스템 - 조직관리 (부서/조직도)
-- =========================================================
-- 교회마다 조직 깊이가 다릅니다(성가대-베이스처럼 2단계, 교육부서-
-- 영아부-1세반처럼 3단계 등). 그래서 "교구/구역/속" 식으로 단계를
-- 고정하지 않고, org_units가 parent_id로 자기 자신을 참조하는
-- 트리 구조로 만들어서 깊이 제한 없이 자유롭게 쌓을 수 있게
-- 했습니다.
--
-- 조직-교인 소속은 members(팀 명단)와 같은 이유로 다대다(N:M)로
-- 뒀습니다 - 한 사람이 "성가대-베이스"와 "교육부서-영아부-교사"에
-- 동시에 속할 수 있습니다.
-- =========================================================

create table if not exists org_units (
  id                    text primary key,
  church_id             text not null references churches(id) on delete cascade,
  parent_id             text references org_units(id) on delete cascade,
  name                  text not null,
  leader_parishioner_id text references parishioners(id) on delete set null,
  order_index           integer not null default 0,
  created_at            bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by            text
);

create table if not exists org_unit_members (
  id                text primary key,
  church_id         text not null references churches(id) on delete cascade,
  org_unit_id       text not null references org_units(id) on delete cascade,
  parishioner_id    text not null references parishioners(id) on delete cascade,
  role_label        text,              -- 예: "팀원", "교사", "총무" 등 자유 입력
  created_at        bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by        text,
  unique (org_unit_id, parishioner_id)
);

create index if not exists org_units_church_idx on org_units (church_id);
create index if not exists org_units_parent_idx on org_units (parent_id);
create index if not exists org_unit_members_church_idx on org_unit_members (church_id);
create index if not exists org_unit_members_unit_idx on org_unit_members (org_unit_id);
create index if not exists org_unit_members_parishioner_idx on org_unit_members (parishioner_id);

alter table org_units enable row level security;
drop policy if exists org_units_all on org_units;
create policy org_units_all on org_units
  for all using (true) with check (true);

alter table org_unit_members enable row level security;
drop policy if exists org_unit_members_all on org_unit_members;
create policy org_unit_members_all on org_unit_members
  for all using (true) with check (true);
