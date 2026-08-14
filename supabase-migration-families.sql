-- =========================================================
-- 교회관리시스템 - 가족관리
-- =========================================================
-- 한 사람은 한 가족에만 속하는 걸로 단순하게 갑니다(재혼 가정 등
-- 예외적인 다중소속은 지원하지 않음 - 필요해지면 나중에 조직관리처럼
-- 다대다로 바꿀 수 있지만, 지금은 이걸로 충분합니다).
--
-- parishioners.family_id는 이미 만들어져 있던 자유 텍스트 컬럼인데,
-- 이번에 실제 families 테이블을 만들면서 그 id를 가리키는 정식
-- 외래키로 바꿉니다.
--
-- ⚠️ 만약 이미 parishioners.family_id에 사람이 손으로 입력해둔 값이
-- 있다면(예: "김철수가족" 같은 텍스트), 아래 FK 제약을 추가하기 전에
-- 반드시 정리가 필요합니다. 필요하면 이 줄의 주석을 풀고 먼저
-- 실행하세요 (기존 값을 전부 비움):
-- update parishioners set family_id = null;
-- =========================================================

create table if not exists families (
  id          text primary key,
  church_id   text not null references churches(id) on delete cascade,
  name        text not null,             -- 예: "김철수 가정"
  address     text,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_by  text
);

create index if not exists families_church_idx on families (church_id);

alter table families enable row level security;
drop policy if exists families_all on families;
create policy families_all on families
  for all using (true) with check (true);

-- parishioners.family_id를 families(id)를 가리키는 정식 외래키로 변경
-- (family_id 인덱스는 supabase-migration-parishioners.sql에서 이미 만듦)
alter table parishioners
  add constraint parishioners_family_id_fkey
  foreign key (family_id) references families(id) on delete set null;
