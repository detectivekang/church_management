-- =========================================================
-- 교회관리시스템 - 교인 상세정보(교적) 테이블
-- =========================================================
-- 기존 church_attendance 프로젝트와 완전히 같은 Supabase
-- 프로젝트/DB에 추가하는 테이블입니다. churches / users /
-- role_contexts 는 그대로 재사용하고, 이 테이블 하나만 새로
-- 추가합니다.
--
-- [참고] 주민등록번호는 일부러 컬럼을 만들지 않았습니다.
-- 교회가 굳이 수집·보관할 법적 의무가 없는 고유식별정보라
-- 유출 시 리스크만 크고 실제 쓰임은 거의 없습니다. 생년월일
-- 정도로 충분합니다.
--
-- members(팀원, 그룹별 출석부 명단)와는 별개의 테이블입니다.
-- members는 "어느 팀 소속인지"가 우선인 출석 체크용 명단이고,
-- 이 parishioners는 "그 사람 자체"에 대한 교회 전체 단일
-- 마스터 레코드입니다. 나중에 필요해지면 linked_member_id로
-- 특정 팀의 members 행 하나와 연결할 수 있게만 열어뒀습니다
-- (지금 당장 강제하지는 않음 - 널이어도 됨).
-- =========================================================

create table if not exists parishioners (
  id                       text primary key,
  church_id                text not null references churches(id) on delete cascade,

  -- 기본정보
  name                     text not null,
  photo_url                text,
  gender                   text,               -- 'M' | 'F'
  birth_date               text,               -- YYYY-MM-DD
  birth_date_calendar      text,               -- 'solar' | 'lunar'
  phone                    text,
  phone_home               text,
  email                    text,
  zonecode                 text,
  address                  text,
  address_detail           text,

  -- 신앙정보
  faith_level              text,               -- 원입/학습/세례/입교 등
  baptism_date             text,
  baptism_church           text,
  confirmation_date        text,               -- 입교일
  position                 text,               -- 직분 (성도/집사/권사/장로/전도사/목사 등)
  position_date            text,               -- 직분 임직일

  -- 소속정보
  department               text,               -- 소속부서 (유년부/청년부/장년부 등)
  district                 text,               -- 교구
  cell                     text,               -- 구역/속
  category_id              text references categories(id) on delete set null,
  group_id                 text references groups(id) on delete set null,
  registration_date        text,
  registration_route       text,               -- 새신자/전입/유아세례/재등록 등
  transferred_from_church  text,

  -- 가족정보
  family_id                text,               -- 같은 가족을 묶는 임의 키
  family_role              text,               -- 본인/배우자/자녀/부모/기타
  marital_status           text,
  wedding_anniversary      text,
  spouse_name              text,

  -- 개인정보
  occupation               text,
  workplace                text,
  education_level          text,
  talents                  text,               -- 은사/특기
  ministry_area            text,               -- 봉사분야
  blood_type               text,
  emergency_contact_name   text,
  emergency_contact_phone  text,

  -- 상태/관리 정보
  member_status            text not null default 'active', -- active/transferred/inactive/deceased/removed
  status_note              text,
  assigned_pastor_email    text,
  notes                    text,

  -- 위 컬럼으로 다 못 담는 교회별 커스텀 항목 (예: "○○교회만 쓰는 항목")
  extra                    jsonb not null default '{}'::jsonb,

  linked_member_id         text references members(id) on delete set null,

  created_at               bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at               bigint,
  created_by               text
);

create index if not exists parishioners_church_idx on parishioners (church_id);
create index if not exists parishioners_name_idx on parishioners (church_id, name);
create index if not exists parishioners_family_idx on parishioners (church_id, family_id);
create index if not exists parishioners_status_idx on parishioners (church_id, member_status);

-- RLS: 기존 테이블들과 동일한 정책 방식을 쓰고 계시다면 아래처럼
-- "로그인한 사용자는 전부 허용, 실제 church_id 스코프는 앱(anon key
-- + 클라이언트 로직)이 담당" 패턴을 그대로 따릅니다. 이미 다른
-- 정책을 쓰고 계시면 이 블록은 건너뛰고 기존 방식에 맞춰주세요.
alter table parishioners enable row level security;
drop policy if exists parishioners_all on parishioners;
create policy parishioners_all on parishioners
  for all using (true) with check (true);
