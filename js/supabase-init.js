/* =========================================================
   [교체] Firebase → Supabase
   - 이 파일 하나가 예전 firebase-init.js를 완전히 대신합니다.
   - db / auth / churchCol() / churchDocRef() / ADMIN_EMAIL 을
     예전과 "똑같은 이름, 똑같은 사용법"으로 다시 만들어서,
     나머지 js 파일(categories.js, groups.js, members.js,
     attendance.js, notices.js, excel.js, auth.js ...)은
     단 한 줄도 고치지 않아도 그대로 동작합니다.
   - 실제 데이터는 Supabase(Postgres)의 fs_documents 테이블에
     Firestore와 비슷한 모양({path, parent, collection, doc_id, data})
     으로 저장됩니다. (supabase-schema.sql 참고)
   ========================================================= */

/* [수정 필요] 아래 두 값을 Supabase 프로젝트의 값으로 바꿔주세요.
   Supabase 대시보드 → Project Settings → API 에서 확인 가능합니다. */
const SUPABASE_URL = "https://gjtavbhpqgertaqdxbbk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Yn3lJNQj2leqFfFL0-_LXQ_4Wxx2J-b";

const ADMIN_EMAIL = "kangseabich@naver.com";

/* [복구] 새 교회에 발급할 가입 코드 (대문자+숫자 6자리, 헷갈리는 0/O/1/I 제외)
   - Firebase/Supabase와 무관한 순수 앱 로직인데, firebase-init.js에서
     supabase-init.js로 옮기면서 실수로 빠졌던 함수 */
function generateChurchCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/* ---------------------------------------------------------
   유틸: 경로/ID 생성
   --------------------------------------------------------- */
function fsGenId() {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}
function fsPath(parent, collection, id) {
  return parent ? `${parent}/${collection}/${id}` : `${collection}/${id}`;
}

/* ---------------------------------------------------------
   문서 스냅샷 / 쿼리 스냅샷 (Firestore DocumentSnapshot/QuerySnapshot 흉내)
   --------------------------------------------------------- */
function makeDocSnapshot(ref, row) {
  return {
    id: ref.id,
    ref,
    exists: !!row,
    data: () => (row ? row.data : undefined),
    _version: row ? row.updated_at : null,
  };
}
function makeQuerySnapshot(rows, parent, collection) {
  const docs = rows.map((r) =>
    makeDocSnapshot(makeDocRef(parent, collection, r.doc_id), r),
  );
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach(fn) {
      docs.forEach(fn);
    },
  };
}

/* ---------------------------------------------------------
   DocumentReference
   --------------------------------------------------------- */
function makeDocRef(parent, collection, id) {
  const path = fsPath(parent, collection, id);
  return {
    id,
    path,
    parent,
    collection,
    async get() {
      const { data: row, error } = await sb
        .from("fs_documents")
        .select("doc_id,data,updated_at")
        .eq("path", path)
        .maybeSingle();
      if (error) throw error;
      return makeDocSnapshot(this, row);
    },
    async set(data, opts) {
      const merge = !!(opts && opts.merge);
      const { error } = await sb.rpc("fs_batch", {
        p_ops: [
          {
            op: "set",
            path,
            parent,
            collection,
            doc_id: id,
            data,
            merge,
          },
        ],
      });
      if (error) throw error;
    },
    async update(data) {
      const { error } = await sb.rpc("fs_batch", {
        p_ops: [{ op: "update", path, parent, collection, doc_id: id, data }],
      });
      if (error) throw error;
    },
    async delete() {
      const { error } = await sb.rpc("fs_batch", {
        p_ops: [{ op: "delete", path, parent, collection, doc_id: id }],
      });
      if (error) throw error;
    },
  };
}

/* ---------------------------------------------------------
   [신규] attendance 전용 문서 참조
   - attendance만 fs_documents(JSONB 통짜 문서) 대신 정규화된
     attendance_records 테이블(교회/예배일/팀원별 행)을 씀.
     이유: (a) 기존엔 예배 1건 = 문서 1개, 그 안에 전체 팀원을
     담은 맵이라 팀원 한 명만 바꿔도 문서 전체를 read-modify-write
     해야 했고 (b) fs_select 정책상 attendance는 로그인만 하면
     다른 교회 것도 조회 가능했던 권한 버그가 있었음(테이블 RLS로
     교회 소속 기준으로 다시 검증). supabase-migration-attendance-
     relational.sql 참고.
   - makeDocRef와 완전히 같은 모양(id/path/parent/collection/
     get/set/update/delete)을 유지해서 attendance.js 등 호출부는
     한 줄도 안 고쳐도 되게 함.
   --------------------------------------------------------- */
function attendanceRowsFromPatch(churchId, serviceId, patch) {
  return Object.keys(patch).map((memberId) => {
    const r = patch[memberId] || {};
    return {
      church_id: churchId,
      service_id: serviceId,
      member_id: memberId,
      present: !!r.present,
      donation: typeof r.donation === "number" ? r.donation : 0,
      bible: Number(r.bible) || 0,
      absent_reason: typeof r.absentReason === "string" ? r.absentReason : "",
    };
  });
}
async function attendanceUpsertPatch(churchId, serviceId, patch) {
  const rows = attendanceRowsFromPatch(churchId, serviceId, patch);
  if (!rows.length) return;
  const { error } = await sb
    .from("attendance_records")
    .upsert(rows, { onConflict: "church_id,service_id,member_id" });
  if (error) throw error;
}
function makeAttendanceDocRef(parent, serviceId) {
  const churchId = parent.split("/")[1];
  const path = fsPath(parent, "attendance", serviceId);
  const ref = {
    id: serviceId,
    path,
    parent,
    collection: "attendance",
    async get() {
      const { data: rows, error } = await sb
        .from("attendance_records")
        .select("member_id,present,donation,bible,absent_reason")
        .eq("church_id", churchId)
        .eq("service_id", serviceId);
      if (error) throw error;
      const map = {};
      (rows || []).forEach((r) => {
        map[r.member_id] = {
          present: r.present,
          donation: r.donation,
          bible: r.bible,
          absentReason: r.absent_reason,
        };
      });
      return {
        id: serviceId,
        ref,
        /* 팀원별 "행" 테이블이라 문서 존재 개념이 없음 - 항상 true로
           두고 빈 맵을 돌려줘도 호출부는 전부 normalizeRecord로 기본값
           처리하므로 동작은 기존과 동일함 */
        exists: true,
        data: () => map,
        _version: null,
      };
    },
    async set(data) {
      await attendanceUpsertPatch(churchId, serviceId, data);
    },
    async update(data) {
      await attendanceUpsertPatch(churchId, serviceId, data);
    },
    async delete() {
      const { error } = await sb
        .from("attendance_records")
        .delete()
        .eq("church_id", churchId)
        .eq("service_id", serviceId);
      if (error) throw error;
    },
  };
  return ref;
}

/* [신규] 한 해(52주치) 출석을 한 번에 불러오기 위한 배치 조회 함수.
   기존에는 attendance.js/data-cache.js가 예배(주일)마다 makeAttendanceDocRef
   의 get()을 따로 호출해서, 팀에 들어갈 때마다 서비스 개수(최대 52개)만큼
   개별 HTTP 요청이 병렬로 나갔음(Promise.all이라 "동시에" 나가긴 하지만
   요청 자체가 52건이라 왕복 지연이 누적됨) - 이것이 "역할 선택 후 로딩이
   너무 오래 걸린다"는 문제의 실제 원인이었음. service_id IN (...) 조건
   하나로 전체를 한 번에 가져와 serviceId별로 그룹화해서 돌려줌 */
async function getAttendanceRowsForServices(churchId, serviceIds) {
  if (!serviceIds || serviceIds.length === 0) return {};
  const { data: rows, error } = await sb
    .from("attendance_records")
    .select("service_id,member_id,present,donation,bible,absent_reason")
    .eq("church_id", churchId)
    .in("service_id", serviceIds);
  if (error) throw error;
  const map = {};
  serviceIds.forEach((id) => {
    map[id] = {};
  });
  (rows || []).forEach((r) => {
    if (!map[r.service_id]) map[r.service_id] = {};
    map[r.service_id][r.member_id] = {
      present: r.present,
      donation: r.donation,
      bible: r.bible,
      absentReason: r.absent_reason,
    };
  });
  return map;
}

/* ---------------------------------------------------------
   [신규] 일반 관계형 테이블 컬렉션 (categories/groups/members/
   categoryEvents 공통) - 컬럼 매핑만 config로 주면 where/orderBy/
   limit/doc/add/get을 fs_documents 대신 실제 테이블로 처리함.
   attendance처럼 여기서도 makeDocRef/makeCollectionRef와 완전히
   같은 모양의 객체를 돌려주므로 호출부(categories.js, groups.js,
   members.js, events.js, group-detail.js, excel.js, attendance.js,
   admin-dashboard.js, important-prayers.js, role-requests.js)는
   전혀 손대지 않아도 됨.
   --------------------------------------------------------- */
const REL_TABLES = {
  categories: {
    table: "categories",
    columns: {
      name: "name",
      operatorEmails: "operator_emails",
      operatorEmail: "operator_email",
      createdAt: "created_at",
    },
  },
  groups: {
    table: "groups",
    columns: {
      categoryId: "category_id",
      name: "name",
      leaderEmails: "leader_emails",
      trackDonation: "track_donation",
      trackBible: "track_bible",
      includeLeaderAttendance: "include_leader_attendance",
      createdAt: "created_at",
    },
  },
  members: {
    table: "members",
    columns: {
      groupId: "group_id",
      name: "name",
      birthday: "birthday",
      createdAt: "created_at",
      longTermAbsent: "long_term_absent",
      longTermAbsentSince: "long_term_absent_since",
      longTermAbsentAuto: "long_term_absent_auto",
    },
  },
  categoryEvents: {
    table: "category_events",
    columns: {
      categoryId: "category_id",
      yearMonth: "year_month",
      week: "week",
      content: "content",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  notices: {
    table: "notices",
    columns: {
      content: "content",
      popup: "popup",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  prayers: {
    table: "prayers",
    columns: {
      groupId: "group_id",
      memberId: "member_id",
      content: "content",
      important: "important",
      createdAt: "created_at",
      authorEmail: "author_email",
      authorName: "author_name",
    },
  },
  roleRequests: {
    table: "role_requests",
    columns: {
      applicantEmail: "applicant_email",
      applicantName: "applicant_name",
      role: "role",
      categoryId: "category_id",
      groupId: "group_id",
      status: "status",
      createdAt: "created_at",
      decidedAt: "decided_at",
      decidedByEmail: "decided_by_email",
    },
  },
  /* [신규] churches/users/appConfig - church 하위가 아니라 최상위
     컬렉션(db.collection(name), parent 없음)이라 church_id로 스코프하지
     않음(root:true) */
  churches: {
    table: "churches",
    root: true,
    columns: {
      name: "name",
      nameKey: "name_key",
      code: "code",
      status: "status",
      plan: "plan",
      ownerEmail: "owner_email",
      adminEmails: "admin_emails",
      createdAt: "created_at",
      zonecode: "zonecode",
      address: "address",
      addressDetail: "address_detail",
      addressKey: "address_key",
      denomination: "denomination",
      pastorName: "pastor_name",
      logoUrl: "logo_url",
      planExpiresAt: "plan_expires_at",
      subscriptionStatus: "subscription_status",
      subscriptionProvider: "subscription_provider",
      nextBillingAt: "next_billing_at",
      subscribedByEmail: "subscribed_by_email",
      subscribedAt: "subscribed_at",
      subscriptionCanceledAt: "subscription_canceled_at",
      subscriptionCanceledByEmail: "subscription_canceled_by_email",
    },
  },
  users: {
    table: "users",
    root: true,
    columns: {
      email: "email",
      name: "name",
      churchId: "church_id",
      createdAt: "created_at",
      agreedTermsAt: "agreed_terms_at",
      agreedPrivacyAt: "agreed_privacy_at",
    },
  },
  appConfig: {
    table: "app_config",
    root: true,
    columns: {
      enabled: "enabled",
      imageUrl: "image_url",
      headline: "headline",
      buttonText: "button_text",
      linkUrl: "link_url",
      updatedAt: "updated_at",
    },
  },
  /* [신규] 교회관리시스템 - 교인 상세정보(교적). church_attendance의
     members(팀별 출석 명단)와는 별개의, 교회 전체 단일 마스터 레코드 */
  parishioners: {
    table: "parishioners",
    columns: {
      name: "name",
      photoUrl: "photo_url",
      gender: "gender",
      birthDate: "birth_date",
      birthDateCalendar: "birth_date_calendar",
      phone: "phone",
      phoneHome: "phone_home",
      email: "email",
      zonecode: "zonecode",
      address: "address",
      addressDetail: "address_detail",
      faithLevel: "faith_level",
      baptismDate: "baptism_date",
      baptismChurch: "baptism_church",
      confirmationDate: "confirmation_date",
      position: "position",
      positionDate: "position_date",
      department: "department",
      district: "district",
      cell: "cell",
      categoryId: "category_id",
      groupId: "group_id",
      registrationDate: "registration_date",
      registrationRoute: "registration_route",
      transferredFromChurch: "transferred_from_church",
      familyId: "family_id",
      familyRole: "family_role",
      maritalStatus: "marital_status",
      weddingAnniversary: "wedding_anniversary",
      spouseName: "spouse_name",
      occupation: "occupation",
      workplace: "workplace",
      educationLevel: "education_level",
      talents: "talents",
      ministryArea: "ministry_area",
      bloodType: "blood_type",
      emergencyContactName: "emergency_contact_name",
      emergencyContactPhone: "emergency_contact_phone",
      memberStatus: "member_status",
      statusNote: "status_note",
      assignedPastorEmail: "assigned_pastor_email",
      notes: "notes",
      extra: "extra",
      linkedMemberId: "linked_member_id",
      createdAt: "created_at",
      updatedAt: "updated_at",
      createdBy: "created_by",
    },
  },
  /* [신규] 심방기록 - parishioners(교적) 한 명당 여러 건 */
  visitations: {
    table: "visitations",
    columns: {
      parishionerId: "parishioner_id",
      visitDate: "visit_date",
      visitType: "visit_type",
      location: "location",
      content: "content",
      prayerRequest: "prayer_request",
      followUpNeeded: "follow_up_needed",
      followUpDate: "follow_up_date",
      visitorEmail: "visitor_email",
      visitorName: "visitor_name",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  /* [신규] 문자발송 이력 - 실제 발송은 send-sms Edge Function이 처리,
     여기서는 결과 조회만 함 */
  smsLogs: {
    table: "sms_logs",
    columns: {
      message: "message",
      recipientCount: "recipient_count",
      recipientNames: "recipient_names",
      status: "status",
      providerMessage: "provider_message",
      sentByEmail: "sent_by_email",
      sentAt: "sent_at",
    },
  },
  /* [신규] 헌금(기부금) 기록 - parishioner 1명당 여러 건 */
  offerings: {
    table: "offerings",
    columns: {
      parishionerId: "parishioner_id",
      offeringDate: "offering_date",
      offeringType: "offering_type",
      amount: "amount",
      memo: "memo",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  /* [신규] 교육관리 - 확신반/성장반 등 과정(courses) + 사람별 이수현황(enrollments) */
  educationCourses: {
    table: "education_courses",
    columns: {
      name: "name",
      description: "description",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  educationEnrollments: {
    table: "education_enrollments",
    columns: {
      courseId: "course_id",
      parishionerId: "parishioner_id",
      status: "status",
      startDate: "start_date",
      completeDate: "complete_date",
      memo: "memo",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  /* [신규] 조직관리 - 부서/조직도. 단계 수를 고정하지 않고 parent_id로
     스스로를 참조하는 트리 구조(성가대-베이스처럼 2단계든,
     교육부서-영아부-1세반처럼 3단계든 자유롭게) */
  orgUnits: {
    table: "org_units",
    columns: {
      parentId: "parent_id",
      name: "name",
      leaderParishionerId: "leader_parishioner_id",
      orderIndex: "order_index",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  orgUnitMembers: {
    table: "org_unit_members",
    columns: {
      orgUnitId: "org_unit_id",
      parishionerId: "parishioner_id",
      roleLabel: "role_label",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  /* [신규] 가족관리 - 한 사람은 한 가족에만 속함(parishioners.family_id가
     이 테이블 id를 가리키는 정식 외래키) */
  families: {
    table: "families",
    columns: {
      name: "name",
      address: "address",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  /* [신규] 행사관리 - 행사(events) + 참석여부(event_participants,
     org_unit_members와 동일한 다대다 패턴) */
  events: {
    table: "events",
    columns: {
      name: "name",
      eventDate: "event_date",
      startTime: "start_time",
      location: "location",
      description: "description",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
  eventParticipants: {
    table: "event_participants",
    columns: {
      eventId: "event_id",
      parishionerId: "parishioner_id",
      status: "status",
      memo: "memo",
      createdAt: "created_at",
      createdBy: "created_by",
    },
  },
};

function relRowToData(config, row) {
  const out = {};
  Object.keys(config.columns).forEach((jsField) => {
    out[jsField] = row[config.columns[jsField]];
  });
  return out;
}
function relDataToRow(config, churchId, data) {
  const row = config.root ? {} : { church_id: churchId };
  Object.keys(data).forEach((jsField) => {
    const col = config.columns[jsField];
    if (col) row[col] = data[jsField];
  });
  return row;
}
function makeRelDocRef(parent, collection, config, id) {
  const churchId = config.root ? null : parent.split("/")[1];
  const path = config.root ? collection + "/" + id : fsPath(parent, collection, id);
  const ref = {
    id,
    path,
    parent,
    collection,
    async get() {
      const { data: row, error } = await sb
        .from(config.table)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return {
        id,
        ref,
        exists: !!row,
        data: () => (row ? relRowToData(config, row) : undefined),
        _version: null,
      };
    },
    async set(data) {
      const row = relDataToRow(config, churchId, data);
      row.id = id;
      const { error } = await sb.from(config.table).upsert(row, { onConflict: "id" });
      if (error) throw error;
    },
    async update(data) {
      const row = relDataToRow(config, churchId, data);
      delete row.church_id;
      const { data: updatedRows, error } = await sb.from(config.table).update(row).eq("id", id).select("id");
      if (error) throw error;
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error("수정하려는 항목을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.");
      }
    },
    async delete() {
      const { error } = await sb.from(config.table).delete().eq("id", id);
      if (error) throw error;
    },
  };
  return ref;
}
function makeRelCollectionRef(parent, collection, config) {
  const churchId = config.root ? null : parent.split("/")[1];
  const filters = [];
  let orderField = null;
  let orderDesc = false;
  let limitN = null;
  const self = {
    where(field, op, val) {
      if (op !== "==") {
        throw new Error("지원하지 않는 쿼리 연산자입니다: " + op);
      }
      filters.push([config.columns[field] || field, val]);
      return self;
    },
    orderBy(field, dir) {
      orderField = config.columns[field] || field;
      orderDesc = dir === "desc";
      return self;
    },
    limit(n) {
      limitN = n;
      return self;
    },
    doc(id) {
      /* users는 이메일을 문서 ID로 씀 - 대소문자 섞인 이메일로 가입한
         사람이 다음 로그인 때 자기 문서를 못 찾는 일이 없도록 소문자로
         맞춤 (roles도 같은 이유였는데 이제 role_contexts 전용 함수로
         분리되어 여기서는 users만 해당) */
      const normalizedId = id && collection === "users" ? id.toLowerCase() : id;
      return makeRelDocRef(parent, collection, config, normalizedId || fsGenId());
    },
    async add(data) {
      const ref = self.doc();
      await ref.set(data);
      return ref;
    },
    async get() {
      let q = sb.from(config.table).select("*");
      if (!config.root) q = q.eq("church_id", churchId);
      filters.forEach(([col, val]) => {
        q = q.eq(col, val);
      });
      if (orderField) q = q.order(orderField, { ascending: !orderDesc });
      if (limitN) q = q.limit(limitN);
      const { data: rows, error } = await q;
      if (error) throw error;
      const docs = (rows || []).map((row) => {
        const docRef = makeRelDocRef(parent, collection, config, row.id);
        return {
          id: row.id,
          ref: docRef,
          exists: true,
          data: () => relRowToData(config, row),
          _version: null,
        };
      });
      return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach(fn) {
          docs.forEach(fn);
        },
      };
    },
  };
  return self;
}

/* ---------------------------------------------------------
   [신규] roles - 이제 컨텍스트 1개당 role_contexts 테이블의 행 1개.
   db.collection("roles").doc(email)는 여전히 예전과 같은 모양
   ({contexts, churchIds, approvedChurchIds})을 돌려주지만, 내부적으로는
   role_contexts를 모아서 만듦. 통짜로 덮어쓰는 set()은 로그인 시
   자가복구(본인의 'none' 자리표시자 최초 생성) 용도로만 남겨두고,
   실제 역할 부여/회수는 addRoleContext()/removeRoleContext()(아래,
   auth.js에서 재정의)가 role_contexts에 행을 직접 넣고 뺌 */
function makeRolesDocRef(rawEmail) {
  const email = (rawEmail || "").toLowerCase();
  const path = "roles/" + email;
  const ref = {
    id: email,
    path,
    parent: "",
    collection: "roles",
    async get() {
      const { data: rows, error } = await sb
        .from("role_contexts")
        .select("role,church_id,category_id,group_id")
        .eq("user_email", email);
      if (error) throw error;
      const contexts = (rows || []).map((r) => {
        const c = { role: r.role, churchId: r.church_id };
        if (r.category_id) c.categoryId = r.category_id;
        if (r.group_id) c.groupId = r.group_id;
        return c;
      });
      const churchIds = [...new Set(contexts.map((c) => c.churchId))];
      const approvedChurchIds = [
        ...new Set(contexts.filter((c) => c.role !== "none").map((c) => c.churchId)),
      ];
      return {
        id: email,
        ref,
        exists: contexts.length > 0,
        data: () => ({ contexts, churchIds, approvedChurchIds }),
        _version: null,
      };
    },
    async set(data) {
      const contexts = (data && data.contexts) || [];
      if (contexts.length !== 1 || contexts[0].role !== "none") {
        throw new Error(
          "roles 문서는 더 이상 통째로 덮어쓸 수 없습니다 - addRoleContext/removeRoleContext를 쓰세요.",
        );
      }
      const { error } = await sb.from("role_contexts").insert({
        user_email: email,
        role: "none",
        church_id: contexts[0].churchId,
      });
      if (error && error.code !== "23505") throw error; // 23505 = 이미 있음(무시)
    },
  };
  return ref;
}
function makeRolesCollectionRef() {
  return {
    doc(id) {
      return makeRolesDocRef(id);
    },
  };
}
function makeAttendanceCollectionRef(parent) {
  return {
    doc(id) {
      return makeAttendanceDocRef(parent, id || fsGenId());
    },
  };
}

/* ---------------------------------------------------------
   CollectionReference (where/orderBy/limit/doc/add/get 지원)
   - 기존 코드가 쓰는 범위(단일 where, 단일 orderBy, limit)만 지원
   --------------------------------------------------------- */
function makeCollectionRef(parent, collection) {
  /* [신규] attendance / categories / groups / members / categoryEvents /
     notices / prayers / roleRequests / churches / users / appConfig는
     fs_documents(JSONB) 대신 정규화된 테이블을 씀. roles는 컨텍스트별
     행으로 쪼갠 role_contexts 전용 참조를 씀 - 각 구현부 주석 및
     supabase-migration-*.sql 참고 */
  if (collection === "attendance") {
    return makeAttendanceCollectionRef(parent);
  }
  if (collection === "roles") {
    return makeRolesCollectionRef();
  }
  if (REL_TABLES[collection]) {
    return makeRelCollectionRef(parent, collection, REL_TABLES[collection]);
  }

  const filters = [];
  let orderField = null;
  let orderDesc = false;
  let limitN = null;

  const self = {
    where(field, op, val) {
      if (op !== "==") {
        throw new Error("지원하지 않는 쿼리 연산자입니다: " + op);
      }
      filters.push([field, val]);
      return self;
    },
    orderBy(field, dir) {
      orderField = field;
      orderDesc = dir === "desc";
      return self;
    },
    limit(n) {
      limitN = n;
      return self;
    },
    doc(id) {
      return makeDocRef(parent, collection, id || fsGenId());
    },
    async add(data) {
      const ref = self.doc();
      await ref.set(data, { merge: false });
      return ref;
    },
    async get() {
      let q = sb
        .from("fs_documents")
        .select("doc_id,data,updated_at")
        .eq("parent", parent)
        .eq("collection", collection);
      filters.forEach(([field, val]) => {
        q = q.eq(`data->>${field}`, val);
      });
      if (orderField) {
        q = q.order(`data->>${orderField}`, { ascending: !orderDesc });
      }
      if (limitN) q = q.limit(limitN);
      const { data: rows, error } = await q;
      if (error) throw error;
      return makeQuerySnapshot(rows, parent, collection);
    },
  };
  return self;
}

/* ---------------------------------------------------------
   db (firebase.firestore() 흉내)
   --------------------------------------------------------- */
const db = {
  collection(name) {
    return makeCollectionRef("", name);
  },
  batch() {
    const ops = [];
    /* [신규] attendance는 fs_documents가 아니라 attendance_records
       테이블로 가야 하므로 따로 모아뒀다가 commit()에서 한 번의
       upsert 문으로 처리함(여러 예배/팀원을 한 문장으로 반영하니
       기존 fs_batch 방식과 동일하게 부분 반영 없이 원자적으로 처리됨) */
    const attendanceSetRows = [];
    const attendanceDeletes = [];
    /* [신규] categories/groups/members/categoryEvents도 마찬가지로
       실제 테이블 upsert/delete로 모아뒀다가 테이블별로 한 번에 반영 */
    const relByTable = {}; // table -> { upserts: [], deletes: [] }
    function relBucket(table) {
      return relByTable[table] || (relByTable[table] = { upserts: [], deletes: [] });
    }
    return {
      set(ref, data, opts) {
        if (ref.collection === "attendance") {
          attendanceSetRows.push(
            ...attendanceRowsFromPatch(ref.parent.split("/")[1], ref.id, data),
          );
          return;
        }
        if (REL_TABLES[ref.collection]) {
          const config = REL_TABLES[ref.collection];
          const row = relDataToRow(config, ref.parent.split("/")[1], data);
          row.id = ref.id;
          relBucket(config.table).upserts.push(row);
          return;
        }
        ops.push({
          op: "set",
          path: ref.path,
          parent: ref.parent,
          collection: ref.collection,
          doc_id: ref.id,
          data,
          merge: !!(opts && opts.merge),
        });
      },
      update(ref, data) {
        if (ref.collection === "attendance") {
          attendanceSetRows.push(
            ...attendanceRowsFromPatch(ref.parent.split("/")[1], ref.id, data),
          );
          return;
        }
        if (REL_TABLES[ref.collection]) {
          /* upsert에 실린 컬럼만 갱신되고(ON CONFLICT DO UPDATE SET이
             지정된 컬럼만 건드림) 나머지 컬럼은 그대로 남으므로, 기존
             행에 대한 부분 업데이트(batch.update)에도 안전하게 씀 */
          const config = REL_TABLES[ref.collection];
          const row = relDataToRow(config, ref.parent.split("/")[1], data);
          row.id = ref.id;
          delete row.church_id;
          relBucket(config.table).upserts.push(row);
          return;
        }
        ops.push({
          op: "update",
          path: ref.path,
          parent: ref.parent,
          collection: ref.collection,
          doc_id: ref.id,
          data,
        });
      },
      delete(ref) {
        if (ref.collection === "attendance") {
          attendanceDeletes.push([ref.parent.split("/")[1], ref.id]);
          return;
        }
        if (REL_TABLES[ref.collection]) {
          relBucket(REL_TABLES[ref.collection].table).deletes.push(ref.id);
          return;
        }
        ops.push({
          op: "delete",
          path: ref.path,
          parent: ref.parent,
          collection: ref.collection,
          doc_id: ref.id,
        });
      },
      async commit() {
        if (ops.length) {
          const { error } = await sb.rpc("fs_batch", { p_ops: ops });
          if (error) throw error;
        }
        if (attendanceSetRows.length) {
          const { error } = await sb
            .from("attendance_records")
            .upsert(attendanceSetRows, {
              onConflict: "church_id,service_id,member_id",
            });
          if (error) throw error;
        }
        for (const [churchId, serviceId] of attendanceDeletes) {
          const { error } = await sb
            .from("attendance_records")
            .delete()
            .eq("church_id", churchId)
            .eq("service_id", serviceId);
          if (error) throw error;
        }
        for (const table of Object.keys(relByTable)) {
          const { upserts, deletes } = relByTable[table];
          if (upserts.length) {
            const { error } = await sb.from(table).upsert(upserts, { onConflict: "id" });
            if (error) throw error;
          }
          if (deletes.length) {
            const { error } = await sb.from(table).delete().in("id", deletes);
            if (error) throw error;
          }
        }
      },
    };
  },
  /* [신규] Firestore의 runTransaction과 동일한 사용법(t.get/t.set/t.update)을
     지원하되, 내부적으로는 낙관적 동시성 제어(CAS) + 재시도로 구현됨.
     동시에 같은 문서를 건드리는 경우가 매우 드문 앱(교회 규모)이라
     실무적으로 충분합니다. */
  async runTransaction(updateFn) {
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const versions = {};
      const ops = [];
      const t = {
        async get(ref) {
          const snap = await ref.get();
          versions[ref.path] = snap._version;
          return snap;
        },
        set(ref, data, opts) {
          ops.push({
            op: "set",
            path: ref.path,
            parent: ref.parent,
            collection: ref.collection,
            doc_id: ref.id,
            data,
            merge: !!(opts && opts.merge),
            expected: Object.prototype.hasOwnProperty.call(versions, ref.path)
              ? versions[ref.path]
              : null,
          });
        },
        update(ref, data) {
          ops.push({
            op: "update",
            path: ref.path,
            parent: ref.parent,
            collection: ref.collection,
            doc_id: ref.id,
            data,
            expected: versions[ref.path] ?? null,
          });
        },
      };
      await updateFn(t);
      const { error } = await sb.rpc("fs_cas_batch", { p_ops: ops });
      if (!error) return;
      if (error.message && error.message.includes("CAS_CONFLICT")) {
        await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
        continue;
      }
      throw error;
    }
    throw new Error(
      "다른 곳에서 동시에 같은 데이터를 수정하고 있어 처리하지 못했습니다. 다시 시도해주세요.",
    );
  },
};

function churchCol(name) {
  return makeCollectionRef("churches/" + currentChurchId, name);
}
function churchDocRef() {
  return makeDocRef("", "churches", currentChurchId);
}

/* ---------------------------------------------------------
   auth (firebase.auth() 흉내)
   --------------------------------------------------------- */
function fsToFirebaseUser(session) {
  if (!session || !session.user) return null;
  const supaUser = session.user;
  return {
    email: supaUser.email,
    uid: supaUser.id,
    async getIdToken(forceRefresh) {
      if (forceRefresh) {
        const { data } = await sb.auth.refreshSession();
        return data.session ? data.session.access_token : null;
      }
      const { data } = await sb.auth.getSession();
      return data.session ? data.session.access_token : null;
    },
  };
}

/* Supabase의 에러 메시지를 기존 translateAuthError()가 이해하는
   Firebase 스타일 코드("auth/xxx")로 변환 - auth.js는 그대로 둠 */
function fsMapAuthError(err) {
  const msg = (err && err.message) || "";
  const map = [
    [/invalid login credentials/i, "auth/invalid-credential"],
    [/email not confirmed/i, "auth/invalid-credential"],
    [
      /user already registered|already registered/i,
      "auth/email-already-in-use",
    ],
    [/password should be at least/i, "auth/weak-password"],
    [/unable to validate email|invalid email/i, "auth/invalid-email"],
    [/user not found/i, "auth/user-not-found"],
  ];
  const hit = map.find(([re]) => re.test(msg));
  const mapped = new Error(msg);
  mapped.code = hit ? hit[1] : "auth/unknown";
  return mapped;
}

const auth = {
  currentUser: null,
  _listeners: [],

  async signInWithEmailAndPassword(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw fsMapAuthError(error);
  },

  async createUserWithEmailAndPassword(email, password, name) {
    /* [수정] 소셜 로그인(카카오 등)은 각 서비스가 프로필 이름을 자동으로
       넘겨줘서 Supabase 대시보드의 "Display name"에 바로 채워지는데,
       이메일 가입은 그런 값이 없어서 원래는 Display name이 계속
       비어있었음(-). name을 user_metadata로 같이 넘겨서 이메일
       가입자도 대시보드에 이름이 뜨도록 맞춤 (앱 자체 로그인/화면
       동작에는 영향 없음 - 순전히 Supabase 대시보드 표시용) */
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: name ? { data: { name, full_name: name } } : undefined,
    });
    if (error) throw fsMapAuthError(error);
    if (!data.session) {
      /* Supabase 프로젝트의 "Confirm email" 설정이 켜져 있으면 가입 직후
         바로 로그인 세션이 생기지 않음(이메일 인증 대기). 이 앱은 가입과
         동시에 여러 문서를 이어서 쓰는 구조라 반드시 즉시 로그인돼야
         하므로, Supabase 대시보드에서 이 옵션을 꺼두어야 합니다
         (Authentication → Providers → Email → Confirm email OFF). */
      throw new Error(
        "이메일 인증이 필요합니다. Supabase 프로젝트의 'Confirm email' 설정을 꺼주세요.",
      );
    }
    auth.currentUser = fsToFirebaseUser(data.session);
  },

  async signOut() {
    await sb.auth.signOut();
  },

  /* [신규] 구글/카카오/네이버 등 소셜 로그인. provider는 Supabase에 등록된
     식별자를 그대로 넘김 - 기본 제공 provider는 'google'/'kakao'처럼
     그대로, 대시보드에서 직접 등록한 Custom Provider는 'custom:naver'처럼
     "custom:" 접두사를 붙여서 넘겨야 함. 성공하면 각 서비스 로그인
     화면으로 브라우저가 이동했다가, 로그인을 마치면 redirectTo로 지정한
     현재 페이지로 돌아오고 onAuthStateChanged가 그 이후 처리를 이어받음 */
  async signInWithOAuth(provider) {
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw fsMapAuthError(error);
  },

  async sendPasswordResetEmail(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) throw fsMapAuthError(error);
  },

  onAuthStateChanged(cb) {
    /* Supabase의 onAuthStateChange는 구독 시점에 현재 세션으로 한 번
       먼저 호출되고, 이후 로그인/로그아웃/토큰갱신 때마다 다시 호출됨 -
       Firebase의 onAuthStateChanged와 동일한 동작이라 별도 초기 조회는
       하지 않음(두 번 호출되는 것을 방지) */
    auth._listeners.push(cb);
    sb.auth.onAuthStateChange((_event, session) => {
      auth.currentUser = fsToFirebaseUser(session);
      cb(auth.currentUser);
    });
  },
};