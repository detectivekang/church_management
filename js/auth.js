/* =========================================================
   인증/라우팅 (교회관리시스템)
   - 이 시스템은 "운영자(=목회자) 전용"입니다. church_attendance와
     완전히 같은 계정/교회 체계(같은 Supabase 프로젝트)를 그대로
     쓰되, 여기서는 운영자(admin) 역할이 있는 계정만 들여보냅니다.
   - 가입 화면은 아직 이 앱에 없습니다(1단계 범위 밖). 새 교회를
     시작하려면 지금은 church_attendance 앱에서 "교회 가입"을 먼저
     해주세요. 이후 단계에서 가입 로직을 Edge Function으로 공유
     함수화해서 이 앱에도 붙일 예정입니다.
   ========================================================= */

document.getElementById("loginBtn").addEventListener("click", async () => {
  const emailEl = document.getElementById("loginEmail");
  const pwEl = document.getElementById("loginPassword");
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  if (!markRequired([emailEl, pwEl])) {
    errEl.textContent = "이메일과 비밀번호를 입력하세요.";
    return;
  }
  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  try {
    await auth.signInWithEmailAndPassword(emailEl.value.trim(), pwEl.value);
  } catch (e) {
    errEl.textContent = translateAuthError(e);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await auth.signOut();
});
document.getElementById("logoutBtnBlocked")?.addEventListener("click", async () => {
  await auth.signOut();
});

/* [신규] 카카오 로그인 - 이메일 로그인과 동일하게 auth.onAuthStateChanged가
   감지해서 자동으로 라우팅함(routeAfterAuth). 이 계정에 아직 roles
   문서가 없으면(교회 가입을 아직 안 한 계정) blockedScreen으로 안내됨 */
document.querySelectorAll("[data-oauth-provider]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const errEl = document.getElementById("loginError");
    errEl.textContent = "";
    try {
      await auth.signInWithOAuth(btn.dataset.oauthProvider);
    } catch (e) {
      errEl.textContent = "소셜 로그인 중 문제가 발생했습니다: " + (e.message || e);
    }
  });
});

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.style.display = "none";
  });
  document.getElementById(id).style.display = "";
}

auth.onAuthStateChanged(async (user) => {
  currentUser = user;
  if (!user) {
    showScreen("loginScreen");
    return;
  }
  showScreen("loadingScreen");
  try {
    await routeAfterAuth(user);
  } catch (e) {
    /* [수정] 여기서 에러가 나면 로딩 화면에서 영원히 멈춰있었음(다음
       화면으로 넘기는 코드가 실행되지 못해서). 이제 무슨 일이
       있었는지 화면에 직접 보여주고, 로그아웃해서 다시 시도할 수
       있게 함 - "불러오는중" 무한 로딩 대신 실제 원인이 보임 */
    console.error("로그인 후 초기화 중 오류:", e);
    document.getElementById("blockedMessage").textContent =
      "불러오는 중 오류가 발생했습니다: " + (e.message || e) +
      "\n\n브라우저 콘솔(F12)에서 자세한 내용을 확인할 수 있습니다.";
    showScreen("blockedScreen");
  }
});

async function routeAfterAuth(user) {
  const email = (user.email || "").toLowerCase();

  const rolesDoc = await db.collection("roles").doc(email).get();
  /* [수정] 이 계정에 roles 문서가 아직 없으면(교회 가입을 아직 안
     밟은 계정 등) rolesDoc.data()가 undefined를 반환하는데, 바로
     구조분해하면서 에러가 나 로딩 화면에서 멈추는 원인이었음.
     "역할 없음"으로 취급해서 안내 화면으로 정상적으로 보냄 */
  const contexts = rolesDoc.exists ? rolesDoc.data().contexts || [] : [];
  userContexts = contexts;

  const adminCtx = contexts.find((c) => c.role === "admin");
  if (!adminCtx) {
    /* 운영자 권한이 없는 계정 - 그룹장/팀장 전용 계정이거나, 아직
       아무 교회에도 승인되지 않은 계정. 이 시스템은 목회자(운영자)
       전용이라 안내만 하고 들여보내지 않음 */
    showScreen("blockedScreen");
    return;
  }

  currentRole = "admin";
  currentChurchId = adminCtx.churchId;

  const churchDoc = await db.collection("churches").doc(currentChurchId).get();
  if (!churchDoc.exists) {
    showScreen("blockedScreen");
    return;
  }
  currentChurchData = churchDoc.data();

  if (currentChurchData.status === "suspended") {
    document.getElementById("blockedMessage").textContent =
      "교회 계정이 일시정지되었습니다. 교회출석부 앱에서 상태를 확인해주세요.";
    showScreen("blockedScreen");
    return;
  }

  document.getElementById("churchNameLabel").textContent = currentChurchData.name || "";
  await Promise.all([loadParishioners(), loadFamilies()]);
  renderParishionerList();
  renderHome();
  showScreen("mainScreen");
}
