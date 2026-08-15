-- =========================================================
-- 교회 출석부 <-> 교회관리시스템 자동 연동
-- =========================================================
-- 두 앱이 이미 같은 Supabase 프로젝트/DB를 쓰고 있고,
-- parishioners 테이블에는 처음부터 이 연동을 염두에 두고
-- 다음 세 컬럼이 열려 있습니다.
--   - parishioners.linked_member_id  -> members(id)   (특정 팀원 1명)
--   - parishioners.group_id          -> groups(id)    (출석부 "팀")
--   - parishioners.category_id       -> categories(id)(출석부 상위 분류)
--
-- 그래서 별도 API/웹훅 없이, members 테이블에 대한 DB 트리거만으로
-- 동기화합니다. (같은 DB 안이라 네트워크 호출도, 인증 토큰 교환도
-- 필요 없고, 실패해도 트랜잭션이 그냥 롤백되니 훨씬 안전합니다.)
--
-- 동작 순서
--   1. 출석부에서 새 팀원(members 행)이 등록되면 트리거 발동.
--   2. "이름 + 생일"이 정확히 일치하고, 아직 다른 출석부 팀원과
--      연동되지 않은 parishioners를 찾습니다.
--        - 정확히 1명 -> 그 사람에게 자동으로 연동
--          (linked_member_id / group_id / category_id 세팅,
--           department가 비어있으면 팀 이름으로 채움)
--        - 0명       -> 새 parishioners를 만들어 바로 연동
--        - 2명 이상  -> 자동으로 아무것도 하지 않고
--                       member_link_queue에 후보 목록과 함께 쌓아둠
--                       (교회관리시스템의 "출석부 연동" 화면에서
--                        관리자가 직접 골라야 함)
--   3. 이미 연동된 팀원의 이름/생일/소속팀이 나중에 출석부에서
--      수정돼도, 이미 연동이 끝난 건은 다시 건드리지 않습니다.
--      (교회관리 쪽에서 관리자가 직접 고쳐둔 값을 트리거가 몰래
--       덮어쓰는 사고를 막기 위함)
--   4. 출석부에서 팀원이 삭제되면 parishioners 레코드 자체는
--      지우지 않고, 연동 표시만 해제합니다 (교적은 남아야 하므로).
-- =========================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- 확인이 필요한 매칭(동명이인 등)을 쌓아두는 대기열
-- ---------------------------------------------------------
create table if not exists member_link_queue (
  id                        text primary key,
  church_id                 text not null references churches(id) on delete cascade,
  member_id                 text not null references members(id) on delete cascade,
  member_name               text not null,
  member_birthday           text,
  group_id                  text,
  group_name                text,
  candidate_ids             text[] not null default '{}',
  status                    text not null default 'pending', -- pending | resolved | ignored
  resolved_parishioner_id   text references parishioners(id) on delete set null,
  resolved_at               bigint,
  resolved_by               text,
  created_at                bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (member_id)
);

create index if not exists member_link_queue_church_idx on member_link_queue (church_id, status);

alter table member_link_queue enable row level security;
drop policy if exists member_link_queue_all on member_link_queue;
create policy member_link_queue_all on member_link_queue
  for all using (true) with check (true);

-- ---------------------------------------------------------
-- members insert/update 시 자동 매칭
-- ---------------------------------------------------------
create or replace function sync_member_to_parishioner()
returns trigger
language plpgsql
as $$
declare
  v_group_name text;
  v_category_id text;
  v_matches text[];
  v_match_count int;
  v_new_id text;
begin
  -- 이미 연동돼 있으면(재실행/사소한 정보 수정 등) 손대지 않음
  if exists (select 1 from parishioners where linked_member_id = new.id) then
    return new;
  end if;

  select name, category_id into v_group_name, v_category_id
  from groups where id = new.group_id;

  select array_agg(id) into v_matches
  from parishioners
  where church_id = new.church_id
    and name = new.name
    and coalesce(birth_date, '') = coalesce(new.birthday, '')
    and linked_member_id is null;

  v_match_count := coalesce(array_length(v_matches, 1), 0);

  if v_match_count = 1 then
    update parishioners
      set linked_member_id = new.id,
          group_id = new.group_id,
          category_id = coalesce(v_category_id, category_id),
          department = coalesce(nullif(department, ''), v_group_name)
      where id = v_matches[1];

  elsif v_match_count = 0 then
    v_new_id := encode(gen_random_bytes(15), 'hex');
    insert into parishioners (
      id, church_id, name, birth_date, department,
      group_id, category_id,
      registration_route, member_status, linked_member_id,
      created_at, created_by
    ) values (
      v_new_id, new.church_id, new.name, new.birthday, v_group_name,
      new.group_id, v_category_id,
      '출석부 자동연동', 'active', new.id,
      (extract(epoch from now()) * 1000)::bigint, 'system:attendance_sync'
    );

  else
    insert into member_link_queue (
      id, church_id, member_id, member_name, member_birthday,
      group_id, group_name, candidate_ids, status, created_at
    ) values (
      encode(gen_random_bytes(15), 'hex'), new.church_id, new.id, new.name, new.birthday,
      new.group_id, v_group_name, v_matches, 'pending',
      (extract(epoch from now()) * 1000)::bigint
    )
    on conflict (member_id) do update
      set member_name = excluded.member_name,
          member_birthday = excluded.member_birthday,
          group_id = excluded.group_id,
          group_name = excluded.group_name,
          candidate_ids = excluded.candidate_ids,
          status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_member_to_parishioner_ins on members;
create trigger trg_sync_member_to_parishioner_ins
  after insert on members
  for each row execute function sync_member_to_parishioner();

-- 아직 연동 전인 팀원의 이름/생일/소속팀이 나중에 고쳐진 경우에도
-- 같은 매칭 로직을 다시 시도합니다. (연동이 끝난 건은 함수 맨 위의
-- exists 체크에서 그대로 걸러집니다)
drop trigger if exists trg_sync_member_to_parishioner_upd on members;
create trigger trg_sync_member_to_parishioner_upd
  after update of name, birthday, group_id on members
  for each row
  when (
    old.name is distinct from new.name
    or old.birthday is distinct from new.birthday
    or old.group_id is distinct from new.group_id
  )
  execute function sync_member_to_parishioner();

-- 출석부에서 팀원이 삭제되면 교적은 남기고 연동 표시만 해제
create or replace function unlink_member_on_delete()
returns trigger
language plpgsql
as $$
begin
  update parishioners set linked_member_id = null where linked_member_id = old.id;
  delete from member_link_queue where member_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_unlink_member_on_delete on members;
create trigger trg_unlink_member_on_delete
  after delete on members
  for each row execute function unlink_member_on_delete();

-- =========================================================
-- 참고: 기존에 이미 출석부에 등록되어 있던 팀원들을 한 번에
-- 소급 적용하고 싶다면(신규 트리거는 "그 이후" insert/update에만
-- 반응하므로), 아래 UPDATE를 딱 한 번 실행해서 트리거를 다시
-- 태우면 됩니다. (name/birthday/group_id를 자기 자신 값으로
-- "재대입"해서 UPDATE 트리거가 걸리게 하는 트릭입니다)
--
--   update members set name = name;
--
-- 교인이 꽤 많다면 실행 전에 반드시 DB 백업/스냅샷을 먼저
-- 떠두시길 권장합니다.
-- =========================================================
