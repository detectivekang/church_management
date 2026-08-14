/* =========================================================
   전역 상태 (교회관리시스템)
   - church_attendance와 같은 계정/교회 체계를 그대로 재사용합니다.
   ========================================================= */
let currentUser = null;
let currentRole = null;
let userContexts = [];

let currentChurchId = null;
let currentChurchData = null;

/* 교적(교인 상세정보) 목록 - 검색은 서버 쿼리 대신 이 캐시를 필터링해서
   처리합니다 (교회 하나당 인원이 수천 명 단위를 넘기 전까지는 이 방식이
   더 빠르고 단순합니다) */
let parishioners = [];
let parishionerSearchKeyword = "";
let parishionerStatusFilter = "active";
let editingParishionerId = null;

/* 심방기록 - 지금 열려있는 교인 모달의 심방기록 캐시 (그 사람 것만) */
let visitations = [];
let parishionerModalTab = "info"; // "info" | "visits"

/* 문자발송 화면 */
let smsSelectedIds = new Set();
let smsRecipientSearchKeyword = "";
let followUpNeededParishionerIds = new Set(); // "후속심방 필요자" 빠른선택용, 화면 진입 시 1회 로드
let smsHistory = [];

/* 헌금 관리 화면 */
let offerings = []; // 지금 선택된 연도의 캐시
let offeringsYear = new Date().getFullYear();
let offeringPickedParishionerId = null; // 등록 폼에서 검색으로 고른 사람
let offeringPersonSearchKeyword = "";
