/**
 * Warehouse Ordering System - Static Frontend for VS Code / Netlify / Vercel
 * วิธีใช้:
 * 1) เอา Code.gs ไปวางใน Apps Script แล้ว Deploy เป็น Web App
 * 2) เอา Web App URL ที่ลงท้าย /exec มาใส่ที่ API_URL ด้านล่าง
 * 3) เปิด index.html ด้วย Live Server หรือ Deploy ขึ้น Netlify/Vercel
 */

// ✅ ใส่ลิงก์ Apps Script Web App /exec ตรงนี้
const API_URL = 'https://script.google.com/macros/s/AKfycbwcVSFEVFnunyeWz94u6aFX7-6IPnjHV8T3aTiWvXX7aVnL3hqc5HK5I8skOuWB7dU_/exec';

let CONFIG = {
  today: todayIso(),
  owners: {
    PUN: {
      key: 'PUN',
      label: 'Punthai',
      menuLabel: 'สั่งสินค้า Punthai',
      compCode: '1021',
      cutoffTime: '11:00',
      orderSheet: 'สาขาสั่งสินค้า_Pun',
      masterItemSheet: 'Master_Item_Pun'
    },
    GFA: {
      key: 'GFA',
      label: 'Coffee World',
      menuLabel: 'สั่งสินค้า Coffee World',
      compCode: '1025',
      cutoffTime: '11:00',
      orderSheet: 'สาขาสั่งสินค้า_GFA',
      masterItemSheet: 'Master_Item_GFA'
    }
  }
};

let OWNERS = CONFIG.owners;
let ACCESS = { email: '', role: 'USER', isAdmin: false };
let GOOGLE_CLIENT_ID = '';
const ADMIN_TOKEN_STORAGE_KEY = 'warehouseOrderingAdminToken';
const ADMIN_EMAIL_STORAGE_KEY = 'warehouseOrderingAdminEmail';
const ADMIN_EXPIRES_STORAGE_KEY = 'warehouseOrderingAdminExpiresAt';
let currentOwnerKey = 'PUN';
let contextTimer = null;
let masterTimer = null;
let lastCycleExport = null;
let CONFIG_PROMISE = null;
const BRANCH_SUGGEST_LIMIT = 7;
const FAST_LOOKUP = {};
const FAST_LOOKUP_PROMISE = {};

document.addEventListener('DOMContentLoaded', async () => {
  armMotionEffects();
  armBranchSearch();
  armSelfServiceSearch();
  armTrackOrderSearch();
  armAdminLoginModal();
  startRealtimeClock();
  const orderDate = document.getElementById('orderDate');
  if (orderDate) orderDate.value = todayIso();
  const exportCycleDate = document.getElementById('exportCycleDate');
  if (exportCycleDate) exportCycleDate.value = todayIso();
  const portalSummaryDate = document.getElementById('portalSummaryDate');
  if (portalSummaryDate) portalSummaryDate.value = todayIso();

  CONFIG_PROMISE = apiRequest('getConfig')
    .then(res => {
      if (res && res.ok) {
        CONFIG = res;
        OWNERS = res.owners || OWNERS;
        ACCESS = normalizeAccess(res.access);
        GOOGLE_CLIENT_ID = String(res.auth?.googleClientId || '').trim();
        initializeGoogleAdminSignIn();
        if (!ACCESS.isAdmin && getStoredAdminToken()) clearStoredAdminSession();
        if (orderDate) orderDate.value = res.today || todayIso();
        if (exportCycleDate) exportCycleDate.value = res.today || todayIso();
      }
      return res;
    })
    .catch(err => {
      toast('ยังไม่ได้เชื่อม API หรือ API_URL ยังไม่ถูกต้อง', 'warn');
      throw err;
    });

  try {
    await CONFIG_PROMISE;
  } catch (err) {
    // API error is handled in CONFIG_PROMISE .catch above
  }

  ensureItemRows();
  applyOwnerStyle('PUN');
  syncSelfServiceOwner();
  syncAccessUI();
  setOwnerSelectors();
  const routed = openInitialRoute();
  if (!routed && isAdmin()) {
    loadDashboard();
    searchMasterItems();
  }
  preloadFastLookupData('PUN');
  setTimeout(() => preloadFastLookupData('GFA'), 900);

  // Handle scroll to show/hide the floating save bar on the order page
  window.addEventListener('scroll', () => {
    const orderSection = document.getElementById('order');
    const floatingBar = document.getElementById('orderFloatingBar');
    if (orderSection && orderSection.classList.contains('active') && floatingBar) {
      if (window.scrollY > 200) {
        floatingBar.classList.add('visible');
      } else {
        floatingBar.classList.remove('visible');
      }
    } else if (floatingBar) {
      floatingBar.classList.remove('visible');
    }
  });
});

/* =========================
 * API Helper
 * ========================= */

function apiRequest(action, params = {}) {
  if (!API_URL || API_URL.includes('PASTE_YOUR')) {
    return Promise.reject(new Error('กรุณาใส่ API_URL ในไฟล์ script.js ก่อน'));
  }

  const callbackName = 'jsonp_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('callback', callbackName);

  const storedAdminToken = getStoredAdminToken();
  if (storedAdminToken && !Object.prototype.hasOwnProperty.call(params || {}, 'adminToken')) {
    url.searchParams.set('adminToken', storedAdminToken);
  }

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'object') {
      url.searchParams.set(key, JSON.stringify(value));
    } else {
      url.searchParams.set(key, String(value));
    }
  });

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('API timeout'));
    }, 30000);

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    script.onerror = () => {
      cleanup();
      reject(new Error('เรียก API ไม่สำเร็จ'));
    };

    script.src = url.toString();
    document.body.appendChild(script);
  });
}

/* =========================
 * Navigation / Owner
 * ========================= */

function openSection(id) {
  if (isAdminSection(id) && !isAdmin()) {
    toast('หน้านี้สำหรับ Admin เท่านั้น', 'warn');
    id = 'home';
  }
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  const section = document.getElementById(id);
  if (section) section.classList.add('active');

  if (id === 'portal') loadPortalSummary();
  if (id === 'dashboard') loadDashboard();
  if (id === 'export') loadCycleExport();
  if (id === 'history') loadHistory();
  if (id === 'master') searchMasterItems();
  if (id === 'logs') loadLogs();
  if (id === 'selfService') syncSelfServiceOwner();

  requestAnimationFrame(() => animateVisibleCards(id));
  window.scrollTo(0, 0);
}

async function selectOwner(ownerKey) {
  currentOwnerKey = ownerKey;
  applyOwnerStyle(ownerKey);
  closeBranchSuggestions();
  closeItemSuggestions();
  const portalSummaryDate = document.getElementById('portalSummaryDate');
  if (portalSummaryDate) portalSummaryDate.value = todayIso();

  // If configuration is still loading in the background, wait for it!
  if (CONFIG_PROMISE) {
    setLoading(true, 'กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...');
    try {
      await CONFIG_PROMISE;
    } catch (e) {
      // Ignore API errors here as they are toasted on startup
    } finally {
      setLoading(false);
    }
  }

  const owner = OWNERS[ownerKey] || {};
  if (isAdmin()) {
    setText('portalTitle', ownerKey === 'PUN' ? 'Punthai Order Portal' : 'Coffee World Order Portal');
    setText('portalSubtitle', `${owner.label || ownerKey} · Admin Menu`);
    setText('portalSheet', owner.orderSheet || '');
  } else {
    setText('portalTitle', ownerKey === 'PUN' ? 'เมนูผู้ใช้งาน Punthai' : 'เมนูผู้ใช้งาน Coffee World');
    setText('portalSubtitle', `Owner ${owner.key || ownerKey} · เลือกทำรายการที่ต้องการ`);
    setText('portalSheet', 'User Menu');
  }
  setText('portalOwnerName', owner.label || ownerKey);
  setText('portalComp', owner.label || ownerKey);
  setText('portalStatusOwner', ownerKey === 'PUN' ? 'PUN' : 'GFA');
  setText('userMenuOwner', ownerKey === 'PUN' ? 'PUN' : 'GFA');
  setOwnerSelectors();
  preloadFastLookupData(ownerKey, true);
  openSection('portal');
}

function startOrder(ownerKey) {
  currentOwnerKey = ownerKey;
  const owner = OWNERS[ownerKey] || OWNERS.PUN;
  applyOwnerStyle(ownerKey);
  closeBranchSuggestions();
  closeItemSuggestions();
  closeSelfBranchSuggestions();

  setText('orderTitle', ownerKey === 'PUN' ? 'ฟอร์มสั่งสินค้า Punthai' : 'ฟอร์มสั่งสินค้า Coffee World');
  setText('orderSubtitle', `${owner.label || owner.key} · บันทึกลง ${owner.orderSheet}`);

  setValue('owner', owner.key);
  setValue('compCode', owner.compCode);
  syncSelfServiceOwner();

  clearOrderContext();
  preloadFastLookupData(ownerKey, true);
  openSection('order');

  if (!document.getElementById('itemBody').children.length) ensureItemRows();
}

function openOwnerSection(id) {
  if (isAdminSection(id) && !isAdmin()) {
    toast('หน้านี้สำหรับ Admin เท่านั้น', 'warn');
    return;
  }
  setOwnerSelectors();
  openSection(id);
}

function armAdminLoginModal() {
  const modal = document.getElementById('adminLoginModal');
  if (!modal) return;
  modal.addEventListener('click', event => {
    if (event.target === modal) closeAdminLogin();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('active')) closeAdminLogin();
  });
  setTimeout(initializeGoogleAdminSignIn, 800);
}

function openAdminLogin() {
  const modal = document.getElementById('adminLoginModal');
  if (!modal) return;

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  initializeGoogleAdminSignIn();
}

function closeAdminLogin() {
  const modal = document.getElementById('adminLoginModal');
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

function initializeGoogleAdminSignIn() {
  const buttonBox = document.getElementById('googleAdminButton');
  const hint = document.getElementById('googleAdminSetupHint');
  if (!buttonBox) return;

  if (!GOOGLE_CLIENT_ID) {
    buttonBox.innerHTML = '<button class="btn" type="button" disabled>รอการตั้งค่า Google Sign-In</button>';
    if (hint) hint.textContent = 'ตั้ง Script Property ชื่อ WAREHOUSE_GOOGLE_CLIENT_ID ใน Apps Script แล้ว Deploy ใหม่';
    return;
  }

  if (!window.google?.accounts?.id) {
    if (hint) hint.textContent = 'กำลังโหลด Google Sign-In...';
    setTimeout(initializeGoogleAdminSignIn, 600);
    return;
  }

  if (buttonBox.dataset.ready === 'true' && buttonBox.dataset.clientId === GOOGLE_CLIENT_ID) return;

  buttonBox.innerHTML = '';
  buttonBox.dataset.ready = 'true';
  buttonBox.dataset.clientId = GOOGLE_CLIENT_ID;
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleAdminCredential,
    ux_mode: 'popup'
  });
  window.google.accounts.id.renderButton(buttonBox, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    logo_alignment: 'left',
    width: Math.min(360, Math.max(260, buttonBox.clientWidth || 360))
  });
  if (hint) hint.textContent = 'เลือกบัญชี Google ที่เป็น Admin ระบบจะตรวจอีเมลให้อัตโนมัติ';
}

async function handleGoogleAdminCredential(response) {
  const idToken = response && response.credential ? response.credential : '';
  if (!idToken) return toast('ไม่พบข้อมูลยืนยันตัวตนจาก Google', 'warn');

  setLoading(true, 'กำลังตรวจสอบบัญชี Google...');
  try {
    const res = await apiRequest('googleAdminLogin', { idToken });
    setLoading(false);
    if (!res.ok) return toast(res.message || 'เข้าสู่ระบบ Admin ด้วย Google ไม่สำเร็จ', 'error');

    saveAdminSession(res.adminToken, res.access?.email || '', res.expiresAt || '');
    ACCESS = normalizeAccess(res.access);
    syncAccessUI();
    setOwnerSelectors();
    closeAdminLogin();
    toast(res.message || 'เข้าสู่ระบบ Admin ด้วย Google สำเร็จ', 'success');
    selectOwner(currentOwnerKey || 'PUN');
  } catch (err) {
    setLoading(false);
    toast(err.message || err, 'error');
  }
}

async function logoutAdmin() {
  const token = getStoredAdminToken();
  clearStoredAdminSession();
  ACCESS = { email: '', role: 'USER', isAdmin: false };
  syncAccessUI();
  openSection('home');
  toast('ออกจากระบบ Admin แล้ว', 'success');
  if (token) {
    try {
      await apiRequest('adminLogout', { adminToken: token });
    } catch (err) {
      // Local logout already completed.
    }
  }
}

function saveAdminSession(token, email, expiresAt) {
  if (!token) return;
  try {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    localStorage.setItem(ADMIN_EMAIL_STORAGE_KEY, email || '');
    localStorage.setItem(ADMIN_EXPIRES_STORAGE_KEY, expiresAt || '');
  } catch (err) {}
}

function clearStoredAdminSession() {
  try {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    localStorage.removeItem(ADMIN_EMAIL_STORAGE_KEY);
    localStorage.removeItem(ADMIN_EXPIRES_STORAGE_KEY);
  } catch (err) {}
}

function getStoredAdminToken() {
  try {
    return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
  } catch (err) {
    return '';
  }
}

function getStoredAdminEmail() {
  try {
    return localStorage.getItem(ADMIN_EMAIL_STORAGE_KEY) || '';
  } catch (err) {
    return '';
  }
}

function normalizeAccess(access) {
  return {
    email: String(access?.email || '').trim(),
    role: String(access?.role || 'USER').trim().toUpperCase(),
    isAdmin: !!access?.isAdmin,
    authMethod: String(access?.authMethod || '').trim()
  };
}

function isAdmin() {
  return ACCESS && ACCESS.isAdmin === true;
}

function isAdminSection(id) {
  return ['dashboard', 'export', 'master', 'logs'].includes(id);
}

function syncAccessUI() {
  document.body.classList.toggle('admin-mode', isAdmin());
  const status = document.getElementById('adminAccessStatus');
  const loginButton = document.getElementById('adminLoginButton');
  const logoutButton = document.getElementById('adminLogoutButton');
  if (status) {
    status.textContent = isAdmin()
      ? `Admin: ${ACCESS.email || getStoredAdminEmail() || 'เข้าสู่ระบบแล้ว'}`
      : 'Admin ใช้ Google Sign-In';
  }
  if (loginButton) loginButton.hidden = isAdmin();
  if (logoutButton) logoutButton.hidden = !isAdmin();
}

function setOwnerSelectors() {
  ['dashboardOwner', 'exportOwner', 'historyOwner', 'masterOwner'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = currentOwnerKey;
  });
  syncSelfServiceOwner();
}

function goBackPortal() {
  openSection('portal');
}

function openInitialRoute() {
  const params = new URLSearchParams(window.location.search);
  const section = String(params.get('section') || '').trim().toLowerCase();
  if (!section) return false;

  const ownerKey = normalizeOwnerKey(params.get('owner'));
  currentOwnerKey = ownerKey;
  applyOwnerStyle(ownerKey);
  setOwnerSelectors();

  if (section === 'order') {
    startOrder(ownerKey);
    return true;
  }
  if (section === 'selfservice' || section === 'self-service' || section === 'self') {
    openSelfService(params.get('tab') || 'cycle');
    return true;
  }
  if (section === 'portal') {
    selectOwner(ownerKey);
    return true;
  }
  if (['dashboard', 'export', 'history', 'master', 'logs'].includes(section)) {
    openOwnerSection(section);
    return true;
  }
  if (section === 'home') {
    openSection('home');
    return true;
  }
  return false;
}

function normalizeOwnerKey(value) {
  const key = String(value || currentOwnerKey || 'PUN').trim().toUpperCase();
  return OWNERS[key] ? key : 'PUN';
}

function openSelfService(mode = 'cycle') {
  syncSelfServiceOwner();
  syncSelfBranchFromOrder();
  openSection('selfService');

  const branchCode = getValue('selfBranchCode').trim();
  if (branchCode) runSelfCycleCheck({ quiet: true });
}

function syncSelfServiceOwner() {
  setText('selfSubtitle', 'ค้นหารหัสสาขาเพื่อดูวันรอบสั่งจาก Master_Pun&GFA');
}

function syncSelfBranchFromOrder() {
  const orderBranch = getValue('branchCode').trim();
  const selfBranch = getValue('selfBranchCode').trim();
  if (orderBranch && !selfBranch) setValue('selfBranchCode', orderBranch);
}

function setSelfServiceMode(mode = 'cycle') {
  document.getElementById('selfCyclePanel')?.classList.add('active');
}

function armSelfServiceSearch() {
  const input = document.getElementById('selfBranchCode');
  const box = document.getElementById('selfBranchSuggestions');
  if (!input || !box) return;

  input.addEventListener('focus', () => showSelfBranchSuggestions(input.value));
  input.addEventListener('input', () => {
    showSelfBranchSuggestions(input.value);
    setText('selfBranchHelper', input.value.trim() ? 'เลือกสาขาจากรายการแนะนำ หรือกดตรวจเมื่อกรอกรหัสตรง' : 'เลือกสาขาจาก Master_Pun&GFA');
  });
  input.addEventListener('keydown', handleSelfBranchSuggestionKeydown);
  input.addEventListener('blur', () => setTimeout(commitSelfBranchInput, 140));
  document.addEventListener('click', event => {
    if (!event.target.closest || event.target.closest('.self-branch-search')) return;
    closeSelfBranchSuggestions();
  });
}

function showSelfBranchSuggestions(query) {
  const box = document.getElementById('selfBranchSuggestions');
  const input = document.getElementById('selfBranchCode');
  if (!box || !input || document.activeElement !== input) return;

  const q = normalizeClientText(query);
  if (!q) {
    closeSelfBranchSuggestions();
    return;
  }

  if (!FAST_LOOKUP[currentOwnerKey]?.branchMap) {
    box.innerHTML = '<div class="branch-option empty-option">กำลังโหลด Master สาขา...</div>';
    box.classList.add('active');
    preloadFastLookupData(currentOwnerKey, true)
      .then(() => showSelfBranchSuggestions(input.value))
      .catch(() => closeSelfBranchSuggestions());
    return;
  }

  const matches = getBranchSuggestions(q);
  if (!matches.length) {
    box.innerHTML = '<div class="branch-option empty-option">ไม่พบสาขาที่ใกล้เคียง</div>';
    box.classList.add('active');
    return;
  }

  box.innerHTML = matches.map((branch, index) => `
    <button type="button" class="branch-option${index === 0 ? ' active' : ''}" data-index="${index}" role="option">
      <b>${escapeHtml(branch.branchCode)}</b>
      <span>${escapeHtml(branch.branchName || '')}</span>
      <small>${escapeHtml([branch.branchZone, formatCycleDays(branch.cycleText)].filter(Boolean).join(' · '))}</small>
    </button>
  `).join('');

  box.querySelectorAll('.branch-option[data-index]').forEach(option => {
    option.addEventListener('mousedown', event => {
      event.preventDefault();
      const branch = matches[Number(option.dataset.index || 0)];
      if (branch) chooseSelfBranchSuggestion(branch);
    });
  });

  box.classList.add('active');
}

function handleSelfBranchSuggestionKeydown(event) {
  const box = document.getElementById('selfBranchSuggestions');
  if (!box || !box.classList.contains('active')) return;

  const options = [...box.querySelectorAll('.branch-option[data-index]')];
  if (!options.length) {
    if (event.key === 'Escape') closeSelfBranchSuggestions();
    return;
  }

  const current = Math.max(options.findIndex(option => option.classList.contains('active')), 0);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(current + 1, options.length - 1)
      : Math.max(current - 1, 0);
    options.forEach(option => option.classList.remove('active'));
    options[nextIndex].classList.add('active');
    options[nextIndex].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const branch = getBranchSuggestions(getValue('selfBranchCode'))[current];
    if (branch) chooseSelfBranchSuggestion(branch);
  } else if (event.key === 'Escape') {
    closeSelfBranchSuggestions();
  }
}

function chooseSelfBranchSuggestion(branch) {
  setValue('selfBranchCode', branch.branchCode || '');
  setText('selfBranchHelper', `${branch.branchName || branch.branchCode} · ${branch.branchZone || '-'} · รอบ ${formatCycleDays(branch.cycleText) || '-'}`);
  closeSelfBranchSuggestions();
  renderBranchCycleResult(branch);
}

function commitSelfBranchInput() {
  const value = getValue('selfBranchCode').trim();
  if (!value) {
    closeSelfBranchSuggestions();
    setText('selfBranchHelper', 'เลือกสาขาจาก Master_Pun&GFA');
    return;
  }

  const exact = getExactBranchMatch(value);
  if (exact) {
    setValue('selfBranchCode', exact.branchCode || value);
    setText('selfBranchHelper', `${exact.branchName || exact.branchCode} · ${exact.branchZone || '-'} · รอบ ${formatCycleDays(exact.cycleText) || '-'}`);
  }
  closeSelfBranchSuggestions();
}

function closeSelfBranchSuggestions() {
  const box = document.getElementById('selfBranchSuggestions');
  if (!box) return;
  box.classList.remove('active');
  box.innerHTML = '';
}

function armTrackOrderSearch() {
  const input = document.getElementById('trackBranchCode');
  const box = document.getElementById('trackBranchSuggestions');
  if (!input || !box) return;

  input.addEventListener('focus', () => showTrackBranchSuggestions(input.value));
  input.addEventListener('input', () => {
    showTrackBranchSuggestions(input.value);
    setText('trackBranchHelper', input.value.trim() ? 'เลือกสาขาจากรายการแนะนำ หรือกดค้นหาเมื่อกรอกรหัสตรง' : 'เลือกสาขาจาก Master_Pun&GFA');
  });
  input.addEventListener('keydown', handleTrackBranchSuggestionKeydown);
  input.addEventListener('blur', () => setTimeout(commitTrackBranchInput, 140));
  document.addEventListener('click', event => {
    if (!event.target.closest || event.target.closest('.self-branch-search')) return;
    closeTrackBranchSuggestions();
  });
}

function showTrackBranchSuggestions(query) {
  const box = document.getElementById('trackBranchSuggestions');
  const input = document.getElementById('trackBranchCode');
  if (!box || !input || document.activeElement !== input) return;

  const q = normalizeClientText(query);
  if (!q) {
    closeTrackBranchSuggestions();
    return;
  }

  if (!FAST_LOOKUP[currentOwnerKey]?.branchMap) {
    box.innerHTML = '<div class="branch-option empty-option">กำลังโหลด Master สาขา...</div>';
    box.classList.add('active');
    preloadFastLookupData(currentOwnerKey, true)
      .then(() => showTrackBranchSuggestions(input.value))
      .catch(() => closeTrackBranchSuggestions());
    return;
  }

  const matches = getBranchSuggestions(q);
  if (!matches.length) {
    box.innerHTML = '<div class="branch-option empty-option">ไม่พบสาขาที่ใกล้เคียง</div>';
    box.classList.add('active');
    return;
  }

  box.innerHTML = matches.map((branch, index) => `
    <button type="button" class="branch-option${index === 0 ? ' active' : ''}" data-index="${index}" role="option">
      <b>${escapeHtml(branch.branchCode)}</b>
      <span>${escapeHtml(branch.branchName || '')}</span>
      <small>${escapeHtml([branch.branchZone, formatCycleDays(branch.cycleText)].filter(Boolean).join(' · '))}</small>
    </button>
  `).join('');

  box.querySelectorAll('.branch-option[data-index]').forEach(option => {
    option.addEventListener('mousedown', event => {
      event.preventDefault();
      const branch = matches[Number(option.dataset.index || 0)];
      if (branch) chooseTrackBranchSuggestion(branch);
    });
  });

  box.classList.add('active');
}

function handleTrackBranchSuggestionKeydown(event) {
  const box = document.getElementById('trackBranchSuggestions');
  if (!box || !box.classList.contains('active')) return;

  const options = [...box.querySelectorAll('.branch-option[data-index]')];
  if (!options.length) {
    if (event.key === 'Escape') closeTrackBranchSuggestions();
    return;
  }

  const current = Math.max(options.findIndex(option => option.classList.contains('active')), 0);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(current + 1, options.length - 1)
      : Math.max(current - 1, 0);
    options.forEach(option => option.classList.remove('active'));
    options[nextIndex].classList.add('active');
    options[nextIndex].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const branch = getBranchSuggestions(getValue('trackBranchCode'))[current];
    if (branch) chooseTrackBranchSuggestion(branch);
  } else if (event.key === 'Escape') {
    closeTrackBranchSuggestions();
  }
}

function chooseTrackBranchSuggestion(branch) {
  setValue('trackBranchCode', branch.branchCode || '');
  setText('trackBranchHelper', `${branch.branchName || branch.branchCode} · ${branch.branchZone || '-'} · รอบ ${formatCycleDays(branch.cycleText) || '-'}`);
  closeTrackBranchSuggestions();
  loadMyOrders({ quiet: true });
}

function commitTrackBranchInput() {
  const value = getValue('trackBranchCode').trim();
  if (!value) {
    closeTrackBranchSuggestions();
    setText('trackBranchHelper', 'เลือกสาขาจาก Master_Pun&GFA');
    return;
  }

  const exact = getExactBranchMatch(value);
  if (exact) {
    setValue('trackBranchCode', exact.branchCode || value);
    setText('trackBranchHelper', `${exact.branchName || exact.branchCode} · ${exact.branchZone || '-'} · รอบ ${formatCycleDays(exact.cycleText) || '-'}`);
  }
  closeTrackBranchSuggestions();
}

function closeTrackBranchSuggestions() {
  const box = document.getElementById('trackBranchSuggestions');
  if (!box) return;
  box.classList.remove('active');
  box.innerHTML = '';
}

async function runSelfCycleCheck(options = {}) {
  setSelfServiceMode('cycle');
  const branchCode = getValue('selfBranchCode').trim();
  const result = document.getElementById('selfCycleResult');
  if (!result) return;

  if (!branchCode) {
    document.getElementById('selfBranchCode')?.focus();
    if (!options.quiet) toast('กรุณาระบุรหัสสาขาก่อนตรวจรอบสั่ง', 'warn');
    return;
  }

  try {
    await preloadFastLookupData(currentOwnerKey, true);
  } catch (err) {
    if (!options.quiet) toast(err.message || err, 'error');
  }

  const branch = getExactBranchMatch(branchCode);
  if (!branch) {
    showSelfBranchSuggestions(branchCode);
    result.innerHTML = `
      <div class="result-icon warn">!</div>
      <h3>ไม่พบสาขาใน Master_Pun&GFA</h3>
      <p>กรุณาเลือกสาขาจากรายการแนะนำ หรือเช็กรหัสสาขาอีกครั้ง</p>
    `;
    result.className = 'self-result warning-state';
    return;
  }

  renderBranchCycleResult(branch);
}

function renderBranchCycleResult(branch) {
  const result = document.getElementById('selfCycleResult');
  if (!result || !branch) return;
  const days = extractCycleDaysClient(branch.cycleText || '');
  const cycleLabel = formatCycleDays(branch.cycleText) || '-';
  const cyclePills = days.length
    ? days.map(day => `<span class="cycle-day-pill">${escapeHtml(getThaiDayClient(day))}</span>`).join('')
    : '<span class="cycle-day-pill muted">ยังไม่ระบุรอบ</span>';
  result.className = 'self-result success-state';
  result.innerHTML = `
    <div class="result-icon ok">✓</div>
    <div>
      <div class="self-result-kicker">${escapeHtml(branch.branchCode)} · ${escapeHtml(branch.branchName || '')}</div>
      <h3>รอบสั่งของสาขานี้</h3>
      <p>ข้อมูลอ้างอิงจาก Sheet Master_Pun&GFA</p>
      <div class="cycle-day-list">${cyclePills}</div>
    </div>
    <div class="self-result-grid">
      <div><span>จังหวัด</span><b>${escapeHtml(branch.branchZone || '-')}</b></div>
      <div><span>SLA</span><b>${escapeHtml(branch.branchSla || '-')}</b></div>
      <div><span>รหัสสาขา</span><b>${escapeHtml(branch.branchCode || '-')}</b></div>
      <div><span>รอบสั่ง</span><b>${escapeHtml(cycleLabel)}</b></div>
    </div>
  `;
}

async function loadMyOrders(options = {}) {
  const branchCode = getValue('trackBranchCode').trim();
  if (!branchCode) {
    document.getElementById('trackBranchCode')?.focus();
    if (!options.quiet) toast('กรุณาระบุรหัสสาขาก่อนดูคำสั่งซื้อ', 'warn');
    return;
  }

  setLoading(true, 'กำลังโหลดคำสั่งซื้อของสาขา...');
  try {
    const res = await apiRequest('myOrders', { ownerKey: currentOwnerKey, branchCode, limit: 120 });
    setLoading(false);
    if (!res.ok) {
      if (/ไม่รู้จัก action|unknown action/i.test(res.message || '')) {
        return loadMyOrdersViaHistory(branchCode);
      }
      return toast(res.message || 'โหลดคำสั่งซื้อไม่สำเร็จ', 'error');
    }
    renderMyOrders(res.orders || [], res.summary || null, branchCode);
  } catch (err) {
    loadMyOrdersViaHistory(branchCode);
  }
}

function loadMyOrdersViaHistory(branchCode) {
  setLoading(true, 'กำลังโหลดคำสั่งซื้อของสาขา...');
  apiRequest('history', { ownerKey: currentOwnerKey, branchCode, limit: 300 })
    .then(res => {
      setLoading(false);
      if (!res.ok) return toast(res.message || 'โหลดคำสั่งซื้อไม่สำเร็จ', 'error');
      const orders = groupHistoryRowsToOrders(res.rows || []);
      renderMyOrders(orders, null, branchCode);
    })
    .catch(historyErr => {
      setLoading(false);
      toast(historyErr.message || historyErr, 'error');
    });
}

function renderMyOrders(orders, summary, branchCode) {
  const body = document.getElementById('myOrdersBody');
  if (!body) return;

  const totalDocs = summary?.totalDocuments ?? orders.length;
  const totalRows = summary?.totalRows ?? orders.reduce((sum, doc) => sum + Number(doc.totalRows || doc.items?.length || 0), 0);
  const totalQty = summary?.totalQty ?? orders.reduce((sum, doc) => sum + Number(doc.totalQty || 0), 0);

  setAnimatedText('myOrderDocCount', numberFmt(totalDocs));
  setAnimatedText('myOrderRowCount', numberFmt(totalRows));
  setAnimatedText('myOrderQty', numberFmt(totalQty));
  setText('myOrdersHint', `รหัสสาขา ${branchCode} · แสดงคำสั่งซื้อล่าสุดของ Owner ${currentOwnerKey}`);

  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty">ยังไม่พบคำสั่งซื้อของสาขานี้</div></td></tr>';
    return;
  }

  body.innerHTML = orders.map(order => `
    <tr>
      <td>${escapeHtml(order.orderDate || order.timestamp || '')}</td>
      <td><b>${escapeHtml(order.documentNo || '-')}</b></td>
      <td>${statusBadge(order.status || 'รอดำเนินการ')}</td>
      <td>${cycleBadge(order.cycleStatus || '')}</td>
      <td>${escapeHtml(numberFmt(order.totalRows || order.items?.length || 0))}</td>
      <td>${escapeHtml(numberFmt(order.totalQty || 0))}</td>
      <td>${escapeHtml(formatOrderItems(order.items || []))}</td>
    </tr>
  `).join('');
}

function groupHistoryRowsToOrders(rows) {
  const map = {};
  (rows || []).forEach(row => {
    const doc = row.documentNo || '-';
    if (!map[doc]) {
      map[doc] = {
        documentNo: doc,
        orderDate: row.orderDate || row.timestamp || '',
        status: row.status || '',
        cycleStatus: row.cycleStatus || '',
        totalRows: 0,
        totalQty: 0,
        items: []
      };
    }
    map[doc].totalRows += 1;
    map[doc].totalQty += Number(row.qty || 0);
    map[doc].items.push({
      itemCode: row.itemCode || '',
      itemName: row.itemName || '',
      qty: row.qty || ''
    });
  });
  return Object.values(map);
}

function formatOrderItems(items) {
  const text = (items || [])
    .slice(0, 4)
    .map(item => `${item.itemCode || ''}${item.itemName ? ' · ' + item.itemName : ''}${item.qty ? ' x' + item.qty : ''}`)
    .filter(Boolean)
    .join(' / ');
  const more = items && items.length > 4 ? ` +${items.length - 4} รายการ` : '';
  return truncate(text + more, 120);
}

function formatCycleDays(cycleText) {
  const days = extractCycleDaysClient(cycleText);
  return days.map(day => getThaiDayClient(day)).join(', ');
}

function statusBadge(status) {
  const text = String(status || '').trim() || 'รอดำเนินการ';
  const cls = /เสร็จ|สำเร็จ|completed|done/i.test(text) ? 'green' : (/ยกเลิก|cancel|error|reject/i.test(text) ? 'danger' : 'warn');
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function applyOwnerStyle(ownerKey) {
  const theme = ownerKey === 'GFA'
    ? {
        color: '#1554b7',
        accent: '#f5c400',
        soft: '#eef5ff',
        logo: 'https://i.postimg.cc/8zd22nWx/LOGO-COFFEEWORLD.png',
        logoAlt: 'Coffee World Logo'
      }
    : {
        color: '#5b371f',
        accent: '#1f8f4d',
        soft: '#f4efe8',
        logo: 'https://i.postimg.cc/fRKwcbHW/Punthai.png',
        logoAlt: 'Punthai Logo'
      };

  document.documentElement.style.setProperty('--owner', theme.color);
  document.documentElement.style.setProperty('--owner-accent', theme.accent);
  document.documentElement.style.setProperty('--owner-soft', theme.soft);

  document.querySelectorAll('[data-owner-icon]').forEach(el => {
    el.classList.add('brand-logo-wrap');
    el.innerHTML = `<img src="${theme.logo}" alt="${theme.logoAlt}" loading="eager">`;
  });
}

/* =========================
 * Lookup / Validate
 * ========================= */

function preloadFastLookupData(ownerKey = currentOwnerKey, showStatus = false) {
  if (FAST_LOOKUP[ownerKey]) return Promise.resolve(FAST_LOOKUP[ownerKey]);
  if (FAST_LOOKUP_PROMISE[ownerKey]) return FAST_LOOKUP_PROMISE[ownerKey];

  if (showStatus) {
    const helper = document.getElementById('cycleHelper');
    if (helper && !helper.textContent) helper.textContent = 'กำลังโหลด Master เพื่อค้นหาแบบเร็ว...';
  }

  FAST_LOOKUP_PROMISE[ownerKey] = apiRequest('fastLookup', { ownerKey })
    .then(res => {
      delete FAST_LOOKUP_PROMISE[ownerKey];
      if (!res.ok) throw new Error(res.message || 'โหลด Master ไม่สำเร็จ');

      // Pre-normalize branch search fields to optimize autocomplete suggestions typing
      if (res.branchMap) {
        Object.values(res.branchMap).forEach(branch => {
          if (!branch) return;
          branch._normalizedCode = normalizeSearchText(branch.branchCode || '');
          branch._normalizedName = normalizeSearchText(branch.branchName || '');
          branch._normalizedZone = normalizeSearchText(branch.branchZone || '');
          branch._normalizedCycle = normalizeSearchText(branch.cycleText || '');
        });
      }

      // Pre-normalize item search fields to optimize autocomplete suggestions typing
      if (res.itemMap) {
        Object.values(res.itemMap).forEach(item => {
          if (!item) return;
          item._normalizedCode = normalizeSearchText(item.itemCode || '');
          item._normalizedName = normalizeSearchText(item.itemName || '');
          item._normalizedSize = normalizeSearchText(item.itemSize || '');
          item._normalizedUom = normalizeSearchText(item.uom || '');
        });

        // Pre-create the clean, cached item rows directly to save GC pressure
        res._itemRows = Object.values(res.itemMap)
          .filter(item => item && item.itemCode)
          .map(item => ({
            itemCode: item.itemCode || '',
            itemName: item.itemName || '',
            itemSize: item.itemSize || '',
            uom: item.uom || '',
            found: true,
            _normalizedCode: item._normalizedCode || '',
            _normalizedName: item._normalizedName || '',
            _normalizedSize: item._normalizedSize || '',
            _normalizedUom: item._normalizedUom || ''
          }));
      }

      FAST_LOOKUP[ownerKey] = res;
      return res;
    })
    .catch(err => {
      delete FAST_LOOKUP_PROMISE[ownerKey];
      throw err;
    });

  return FAST_LOOKUP_PROMISE[ownerKey];
}

function armBranchSearch() {
  const input = document.getElementById('branchCode');
  const box = document.getElementById('branchSuggestions');
  if (!input || !box) return;

  input.addEventListener('focus', () => showBranchSuggestions(input.value));
  input.addEventListener('input', handleBranchInput);
  input.addEventListener('keydown', handleBranchSuggestionKeydown);
  input.addEventListener('blur', () => setTimeout(commitBranchInput, 140));
  document.addEventListener('click', event => {
    if (!event.target.closest || event.target.closest('.branch-search')) return;
    closeBranchSuggestions();
  });
}

function handleBranchInput() {
  const input = document.getElementById('branchCode');
  const value = input ? input.value.trim() : '';
  showBranchSuggestions(value);

  clearTimeout(contextTimer);
  if (!value) {
    clearOrderContext();
    return;
  }

  const exact = getExactBranchMatch(value);
  if (exact) {
    contextTimer = setTimeout(() => chooseBranchSuggestion(exact, { keepFocus: true, quiet: true }), 160);
  } else {
    clearOrderContext();
    setValue('branchName', 'เลือกสาขาจากรายการแนะนำก่อนบันทึก');
  }
}

function showBranchSuggestions(query) {
  const box = document.getElementById('branchSuggestions');
  const input = document.getElementById('branchCode');
  if (!box || !input || document.activeElement !== input) return;

  const q = normalizeClientText(query);
  if (!q) {
    closeBranchSuggestions();
    return;
  }

  if (!FAST_LOOKUP[currentOwnerKey]?.branchMap) {
    box.innerHTML = '<div class="branch-option empty-option">กำลังโหลด Master สาขา...</div>';
    box.classList.add('active');
    preloadFastLookupData(currentOwnerKey, true)
      .then(() => {
        showBranchSuggestions(input.value);
        const exact = getExactBranchMatch(input.value);
        if (exact) chooseBranchSuggestion(exact, { keepFocus: true, quiet: true });
      })
      .catch(() => closeBranchSuggestions());
    return;
  }

  const matches = getBranchSuggestions(q);
  if (!matches.length) {
    box.innerHTML = '<div class="branch-option empty-option">ไม่พบสาขาที่ใกล้เคียง</div>';
    box.classList.add('active');
    return;
  }

  box.innerHTML = matches.map((branch, index) => `
    <button type="button" class="branch-option${index === 0 ? ' active' : ''}" data-index="${index}" role="option">
      <b>${escapeHtml(branch.branchCode)}</b>
      <span>${escapeHtml(branch.branchName || '')}</span>
      <small>${escapeHtml([branch.branchZone, branch.cycleText].filter(Boolean).join(' · '))}</small>
    </button>
  `).join('');

  box.querySelectorAll('.branch-option[data-index]').forEach(option => {
    option.addEventListener('mousedown', event => {
      event.preventDefault();
      const branch = matches[Number(option.dataset.index || 0)];
      if (branch) chooseBranchSuggestion(branch);
    });
  });

  box.classList.add('active');
}

function getBranchSuggestions(query, limit = BRANCH_SUGGEST_LIMIT) {
  const data = FAST_LOOKUP[currentOwnerKey];
  if (!data || !data.branchMap) return [];

  const q = normalizeSearchText(query);
  if (!q) return [];

  const branches = Object.values(data.branchMap);
  const len = branches.length;
  const matches = [];

  for (let i = 0; i < len; i++) {
    const branch = branches[i];
    const code = branch._normalizedCode !== undefined ? branch._normalizedCode : normalizeSearchText(branch.branchCode || '');
    const name = branch._normalizedName !== undefined ? branch._normalizedName : normalizeSearchText(branch.branchName || '');
    const zone = branch._normalizedZone !== undefined ? branch._normalizedZone : normalizeSearchText(branch.branchZone || '');
    const cycle = branch._normalizedCycle !== undefined ? branch._normalizedCycle : normalizeSearchText(branch.cycleText || '');
    let score = 99;

    if (code === q) score = 0;
    else if (code.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (zone.startsWith(q)) score = 3;
    else if (code.includes(q)) score = 4;
    else if (name.includes(q)) score = 5;
    else if (zone.includes(q) || cycle.includes(q)) score = 6;

    if (score < 99) {
      matches.push({ branch, score });
    }
  }

  matches.sort((a, b) => a.score - b.score || String(a.branch.branchCode).localeCompare(String(b.branch.branchCode), 'th'));
  return matches.slice(0, limit).map(row => row.branch);
}

function getExactBranchMatch(query) {
  const data = FAST_LOOKUP[currentOwnerKey];
  if (!data || !data.branchMap) return null;

  const q = normalizeSearchText(query);
  if (!q) return null;

  const byCode = data.branchMap[q];
  if (byCode) return byCode;

  const byName = Object.values(data.branchMap).filter(branch => normalizeSearchText(branch.branchName) === q);
  return byName.length === 1 ? byName[0] : null;
}

function handleBranchSuggestionKeydown(event) {
  const box = document.getElementById('branchSuggestions');
  if (!box || !box.classList.contains('active')) return;

  const options = [...box.querySelectorAll('.branch-option[data-index]')];
  if (!options.length) {
    if (event.key === 'Escape') closeBranchSuggestions();
    return;
  }

  const current = Math.max(options.findIndex(option => option.classList.contains('active')), 0);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(current + 1, options.length - 1)
      : Math.max(current - 1, 0);
    options.forEach(option => option.classList.remove('active'));
    options[nextIndex].classList.add('active');
    options[nextIndex].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const branch = getBranchSuggestions(getValue('branchCode'))[current];
    if (branch) chooseBranchSuggestion(branch);
  } else if (event.key === 'Escape') {
    closeBranchSuggestions();
  }
}

function chooseBranchSuggestion(branch, options = {}) {
  setValue('branchCode', branch.branchCode || '');
  closeBranchSuggestions();
  validateContext();
  updateOrderHealth();
  if (!options.keepFocus) document.getElementById('branchEmail')?.focus();
  if (!options.quiet) toast(`เลือกสาขา ${branch.branchCode} · ${branch.branchName || ''}`, 'success');
}

function commitBranchInput() {
  const value = getValue('branchCode').trim();
  if (!value) {
    closeBranchSuggestions();
    clearOrderContext();
    return;
  }

  const exact = getExactBranchMatch(value);
  if (exact) {
    chooseBranchSuggestion(exact, { keepFocus: true, quiet: true });
    return;
  }

  const suggestions = getBranchSuggestions(value, 2);
  closeBranchSuggestions();
  clearOrderContext();
  setValue('branchName', suggestions.length ? 'กรุณาเลือกสาขาจากรายการแนะนำ' : `ไม่พบสาขา "${value}" ใน Master`);
  updateOrderHealth();
}

function closeBranchSuggestions() {
  const box = document.getElementById('branchSuggestions');
  if (!box) return;
  box.classList.remove('active');
  box.innerHTML = '';
}

function validateContext() {
  const branchCode = getValue('branchCode').trim();
  const orderDate = getValue('orderDate');
  if (!branchCode || !orderDate) {
    clearOrderContext();
    return;
  }

  if (validateContextLocal(branchCode, orderDate)) return;

  preloadFastLookupData(currentOwnerKey, true)
    .then(() => {
      const latestBranchCode = getValue('branchCode').trim();
      const latestOrderDate = getValue('orderDate');
      if (!latestBranchCode || !latestOrderDate) return;
      if (!validateContextLocal(latestBranchCode, latestOrderDate)) {
        validateContextServer(latestBranchCode, latestOrderDate);
      }
    })
    .catch(() => validateContextServer(branchCode, orderDate));
}

function debouncedValidateContext() {
  clearTimeout(contextTimer);
  contextTimer = setTimeout(validateContext, 120);
}

function validateContextLocal(branchCode, orderDate) {
  const data = FAST_LOOKUP[currentOwnerKey];
  if (!data || !data.branchMap) return false;

  const key = normalizeClientText(branchCode).toLowerCase();
  const branch = data.branchMap[key];

  if (!branch) {
    const suggestions = getBranchSuggestions(branchCode, 1);
    clearOrderContext();
    setValue('branchName', suggestions.length ? 'กรุณาเลือกสาขาจากรายการแนะนำ' : `ไม่พบสาขา "${branchCode}" ใน Master`);
    updateOrderHealth();
    return true;
  }

  const cycle = checkOrderCycleClient(orderDate, branch.cycleText || '');
  setValue('branchCode', branch.branchCode || branchCode);
  setValue('branchName', branch.branchName || branchCode);
  setValue('branchEmail', branch.branchEmail || '');
  setValue('branchZone', branch.branchZone || '');
  setValue('documentNo', buildDocumentNoClient(branch.branchCode || branchCode, orderDate));
  setCycleStatus(cycle.status);
  setText('cycleHelper', `วันที่เลือกคือวัน${cycle.dayThai} (${cycle.dayShort}) · รอบใน Master: ${branch.cycleText || '-'}`);
  updateOrderHealth();
  return true;
}

function validateContextServer(branchCode, orderDate) {
  apiRequest('validateOrder', { ownerKey: currentOwnerKey, branchCode, orderDate })
    .then(res => {
      if (!res.ok) {
        clearOrderContext();
        setValue('branchName', res.message || 'ไม่พบข้อมูล');
        return;
      }

      const ctx = res.context;
      setValue('branchCode', ctx.branchCode);
      setValue('branchName', ctx.branchName);
      setValue('branchEmail', ctx.branchEmail || '');
      setValue('branchZone', ctx.branchZone || '');
      setValue('documentNo', ctx.documentNo);
      setCycleStatus(ctx.orderCycleStatus);
      setText('cycleHelper', `วันที่เลือกคือวัน${ctx.orderDayTh} (${ctx.orderDay}) · รอบใน Master: ${ctx.cycleText || '-'}`);
      updateOrderHealth();
    })
    .catch(err => {
      clearOrderContext();
      toast(err.message || err, 'error');
    });
}

function clearOrderContext() {
  setValue('branchName', '');
  setValue('branchEmail', '');
  setValue('branchZone', '');
  setValue('documentNo', '');
  setCycleStatus('');
  setText('cycleHelper', '');
  updateOrderHealth();
}

function setCycleStatus(statusText) {
  const el = document.getElementById('cycleStatus');
  if (!el) return;
  const text = String(statusText || '').trim();
  el.value = text;
  el.classList.remove('ok', 'bad', 'empty');

  if (text === 'รอบสั่งสาขา') el.classList.add('ok');
  else if (text === 'ไม่ใช่รอบสาขา') el.classList.add('bad');
  else el.classList.add('empty');
  updateOrderHealth();
}

/* =========================
 * Order Items
 * ========================= */

const ITEM_SUGGEST_LIMIT = 8;
const DEFAULT_ITEM_ROWS = 14;
let itemTableArmed = false;

function ensureItemRows(minRows = DEFAULT_ITEM_ROWS) {
  const body = document.getElementById('itemBody');
  if (!body) return;
  while (body.children.length < minRows) addItemRow();
  refreshItemNo();
  updateItemSummary();
}

function addItemRow(item = {}) {
  armItemTableShortcuts();
  const body = document.getElementById('itemBody');
  const tr = document.createElement('tr');

  tr.innerHTML = `
    <td class="item-no"></td>
    <td class="item-lookup-cell">
      <div class="item-search">
        <input type="text" class="item-code grid-input" data-col="code" autocomplete="off" placeholder="รหัส / ชื่อสินค้า" value="${escapeAttr(item.itemCode || '')}">
        <div class="item-suggestions" role="listbox"></div>
      </div>
      <div class="mini item-message"></div>
    </td>
    <td><input type="text" class="item-name" readonly placeholder="ระบบจะดึงชื่อ Item"></td>
    <td><input type="text" class="item-size" readonly placeholder="ขนาดรรจุ"></td>
    <td><input type="text" class="item-uom" readonly placeholder="UOM"></td>
    <td><input type="number" class="item-qty grid-input" data-col="qty" min="1" step="1" placeholder="จำนวน" value="${escapeAttr(item.qty || '')}"></td>
    <td><textarea class="item-note grid-input" data-col="note" placeholder="หมายเหตุ">${escapeHtml(item.note || '')}</textarea></td>
    <td class="row-action-cell"><button class="row-delete" type="button" aria-label="ลบรายการ" title="ลบรายการ">×</button></td>
  `;

  body.appendChild(tr);
  tr.classList.add('item-row-enter');
  setTimeout(() => tr.classList.remove('item-row-enter'), 450);

  tr.querySelector('.row-delete').addEventListener('click', () => {
    tr.classList.add('row-remove');
    setTimeout(() => {
      tr.remove();
      ensureItemRows();
      refreshItemNo();
      updateItemSummary();
    }, 180);
  });

  const codeInput = tr.querySelector('.item-code');
  const resolveLater = debounce(() => resolveItemInput(tr, { silent: true }), 140);

  codeInput.addEventListener('focus', () => showItemSuggestions(tr, codeInput.value));
  codeInput.addEventListener('input', () => {
    showItemSuggestions(tr, codeInput.value);
    resolveLater();
    updateItemSummary();
  });
  codeInput.addEventListener('change', () => resolveItemInput(tr, { commitBestMatch: true }));

  tr.querySelector('.item-qty').addEventListener('input', updateItemSummary);
  tr.querySelector('.item-note').addEventListener('input', updateItemSummary);

  refreshItemNo();
  if (item.itemCode) resolveItemInput(tr, { commitBestMatch: true, silent: true });
  updateItemSummary();
  return tr;
}

function refreshItemNo() {
  [...document.querySelectorAll('#itemBody tr')].forEach((tr, index) => {
    tr.querySelector('.item-no').textContent = index + 1;
  });
}

function armItemTableShortcuts() {
  if (itemTableArmed) return;
  const body = document.getElementById('itemBody');
  if (!body) return;

  itemTableArmed = true;
  body.addEventListener('keydown', handleItemGridKeydown);
  body.addEventListener('paste', handleItemGridPaste);
  body.addEventListener('focusin', event => {
    const row = event.target.closest && event.target.closest('tr');
    if (row) row.classList.add('active-grid-row');
  });
  body.addEventListener('focusout', event => {
    const row = event.target.closest && event.target.closest('tr');
    if (row) row.classList.remove('active-grid-row');
  });
  document.addEventListener('click', event => {
    if (!event.target.closest || event.target.closest('.item-search')) return;
    closeItemSuggestions();
  });
}

function handleItemGridKeydown(event) {
  const target = event.target.closest && event.target.closest('.grid-input');
  if (!target) return;

  const tr = target.closest('tr');
  if (target.classList.contains('item-code') && handleSuggestionKeydown(event, tr)) return;

  if (event.key === 'Enter') {
    if (target.tagName === 'TEXTAREA' && event.shiftKey) return;
    event.preventDefault();
    if (target.classList.contains('item-code')) {
      resolveItemInput(tr, { commitBestMatch: true });
    }
    moveGridFocus(target, event.shiftKey ? -1 : 1);
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    if (target.classList.contains('item-code')) {
      resolveItemInput(tr, { commitBestMatch: true });
    }
    moveGridFocus(target, event.shiftKey ? -1 : 1);
  }
}

function moveGridFocus(target, direction) {
  const body = document.getElementById('itemBody');
  const fields = [...body.querySelectorAll('.grid-input')];
  const index = fields.indexOf(target);
  let next = fields[index + direction];

  if (!next && direction > 0) {
    const row = addItemRow();
    next = row.querySelector('.item-code');
  }

  if (next) {
    next.focus();
    if (next.select) next.select();
  }
}

function handleItemGridPaste(event) {
  const target = event.target.closest && event.target.closest('.grid-input');
  if (!target) return;

  const raw = event.clipboardData ? event.clipboardData.getData('text') : '';
  if (!raw || (!raw.includes('\n') && !raw.includes('\t'))) return;

  event.preventDefault();
  const currentRow = target.closest('tr');
  const rows = [...document.querySelectorAll('#itemBody tr')];
  const startIndex = Math.max(rows.indexOf(currentRow), 0);
  applyPastedItems(parsePastedItemRows(raw), startIndex);
}

function lookupItemForRow(tr) {
  resolveItemInput(tr, { commitBestMatch: true });
}

function resolveItemInput(tr, options = {}) {
  const itemCode = tr.querySelector('.item-code').value.trim();
  const nameInput = tr.querySelector('.item-name');
  const sizeInput = tr.querySelector('.item-size');
  const uomInput = tr.querySelector('.item-uom');
  const msg = tr.querySelector('.item-message');

  if (!itemCode) {
    clearItemLookupState(tr);
    return;
  }

  tr.dataset.lookupCode = itemCode;
  const localItem = lookupItemLocal(itemCode, options);
  if (localItem && localItem.found) {
    renderItemLookupResult(tr, localItem);
    closeItemSuggestions(tr);
    return;
  }

  if (localItem && localItem.pending) {
    nameInput.value = '';
    sizeInput.value = '';
    uomInput.value = '';
    tr.dataset.itemFound = 'pending';
    msg.textContent = 'เลือกสินค้าจากรายการแนะนำ';
    msg.style.color = 'var(--warning)';
    updateItemSummary();
    return;
  }

  if (localItem && !localItem.found) {
    if (!options.silent) renderItemLookupResult(tr, localItem);
    else {
      nameInput.value = '';
      sizeInput.value = '';
      uomInput.value = '';
      tr.dataset.itemFound = 'false';
      msg.textContent = 'ยังไม่พบใน Master';
      msg.style.color = 'var(--warning)';
      updateItemSummary();
    }
    return;
  }

  if (!options.silent) {
    msg.textContent = 'กำลังโหลด Master...';
    msg.style.color = 'var(--muted)';
  }

  preloadFastLookupData(currentOwnerKey, true)
    .then(() => {
      if (tr.dataset.lookupCode !== itemCode) return;
      const item = lookupItemLocal(itemCode, options);
      if (item && item.found) renderItemLookupResult(tr, item);
      else if (item && item.pending) {
        tr.dataset.itemFound = 'pending';
        msg.textContent = 'เลือกสินค้าจากรายการแนะนำ';
        msg.style.color = 'var(--warning)';
        updateItemSummary();
      }
      else if (item && !item.found) renderItemLookupResult(tr, item);
      else lookupItemForRowServer(tr, itemCode);
    })
    .catch(() => lookupItemForRowServer(tr, itemCode));
}

function lookupItemLocal(itemCode, options = {}) {
  const data = FAST_LOOKUP[currentOwnerKey];
  if (!data || !data.itemMap) return null;

  const code = normalizeClientText(itemCode);
  const codeKey = normalizeSearchText(code);
  const found = data.itemMap[codeKey];
  if (found) {
    return {
      itemCode: found.itemCode || code,
      itemName: found.itemName || '',
      itemSize: found.itemSize || '',
      uom: found.uom || '',
      found: true
    };
  }

  if (options.commitBestMatch) {
    const exactName = getItemRowsForOwner().find(item => normalizeSearchText(item.itemName) === codeKey);
    if (exactName) return { ...exactName, found: true };

    const suggestions = getItemSuggestions(code, 2);
    if (suggestions.length === 1) return { ...suggestions[0], found: true };
    if (suggestions.length > 1) {
      return { itemCode: code, itemName: '', itemSize: '', uom: '', found: false, pending: true };
    }
  } else if (getItemSuggestions(code, 1).length) {
    return { itemCode: code, itemName: '', itemSize: '', uom: '', found: false, pending: true };
  }

  return {
    itemCode: code,
    itemName: 'ไม่พบใน Master Item',
    itemSize: '',
    uom: '',
    found: false
  };
}

function lookupItemForRowServer(tr, itemCode) {
  apiRequest('lookupItem', { ownerKey: currentOwnerKey, itemCode })
    .then(res => {
      if (tr.dataset.lookupCode !== itemCode) return;
      if (!res.ok) {
        tr.querySelector('.item-name').value = '';
        tr.querySelector('.item-size').value = '';
        tr.querySelector('.item-uom').value = '';
        const msg = tr.querySelector('.item-message');
        msg.textContent = res.message || 'ค้นหาไม่สำเร็จ';
        msg.style.color = 'var(--danger)';
        tr.dataset.itemFound = 'false';
        updateItemSummary();
        return;
      }
      renderItemLookupResult(tr, res.item);
    })
    .catch(err => {
      if (tr.dataset.lookupCode !== itemCode) return;
      const msg = tr.querySelector('.item-message');
      msg.textContent = err.message || err;
      msg.style.color = 'var(--danger)';
      tr.dataset.itemFound = 'false';
      updateItemSummary();
    });
}

function renderItemLookupResult(tr, item) {
  if (item.found && item.itemCode) tr.querySelector('.item-code').value = item.itemCode;
  tr.querySelector('.item-name').value = item.itemName || '';
  tr.querySelector('.item-size').value = item.itemSize || '';
  tr.querySelector('.item-uom').value = item.uom || '';
  tr.dataset.itemFound = item.found ? 'true' : 'false';
  const msg = tr.querySelector('.item-message');
  msg.textContent = item.found ? 'พบใน Master' : 'ไม่พบใน Master แต่ยังบันทึกได้';
  msg.style.color = item.found ? 'var(--success)' : 'var(--warning)';
  flashLookupRow(tr, item.found);
  updateItemSummary();
}

function clearItemLookupState(tr) {
  tr.querySelector('.item-name').value = '';
  tr.querySelector('.item-size').value = '';
  tr.querySelector('.item-uom').value = '';
  tr.querySelector('.item-message').textContent = '';
  tr.dataset.itemFound = '';
  closeItemSuggestions(tr);
  updateItemSummary();
}

function getItemRowsForOwner(ownerKey = currentOwnerKey) {
  const data = FAST_LOOKUP[ownerKey];
  if (!data || !data.itemMap) return [];
  if (data._itemRows) return data._itemRows;

  data._itemRows = Object.values(data.itemMap)
    .filter(item => item && item.itemCode)
    .map(item => ({
      itemCode: item.itemCode || '',
      itemName: item.itemName || '',
      itemSize: item.itemSize || '',
      uom: item.uom || '',
      found: true,
      _normalizedCode: normalizeSearchText(item.itemCode || ''),
      _normalizedName: normalizeSearchText(item.itemName || ''),
      _normalizedSize: normalizeSearchText(item.itemSize || ''),
      _normalizedUom: normalizeSearchText(item.uom || '')
    }));
  return data._itemRows;
}

function getItemSuggestions(query, limit = ITEM_SUGGEST_LIMIT) {
  const q = normalizeSearchText(query);
  if (!q) return [];

  const items = getItemRowsForOwner();
  const len = items.length;
  const matches = [];

  for (let i = 0; i < len; i++) {
    const item = items[i];
    const code = item._normalizedCode !== undefined ? item._normalizedCode : normalizeSearchText(item.itemCode || '');
    const name = item._normalizedName !== undefined ? item._normalizedName : normalizeSearchText(item.itemName || '');
    const size = item._normalizedSize !== undefined ? item._normalizedSize : normalizeSearchText(item.itemSize || '');
    const uom = item._normalizedUom !== undefined ? item._normalizedUom : normalizeSearchText(item.uom || '');
    let score = 99;

    if (code === q) score = 0;
    else if (code.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (code.includes(q)) score = 3;
    else if (name.includes(q)) score = 4;
    else if (size.includes(q) || uom.includes(q)) score = 5;

    if (score < 99) {
      matches.push({ item, score });
    }
  }

  matches.sort((a, b) => a.score - b.score || String(a.item.itemCode).localeCompare(String(b.item.itemCode), 'th'));
  return matches.slice(0, limit).map(row => row.item);
}

function showItemSuggestions(tr, query) {
  const box = tr.querySelector('.item-suggestions');
  if (!box) return;
  const q = normalizeClientText(query);

  if (!q) {
    closeItemSuggestions(tr);
    return;
  }

  if (!FAST_LOOKUP[currentOwnerKey]?.itemMap) {
    box.innerHTML = '<div class="item-option empty-option">กำลังโหลด Master...</div>';
    box.classList.add('active');
    preloadFastLookupData(currentOwnerKey, true)
      .then(() => {
        if (document.activeElement === tr.querySelector('.item-code')) showItemSuggestions(tr, query);
      })
      .catch(() => {});
    return;
  }

  const matches = getItemSuggestions(q);
  if (!matches.length) {
    box.innerHTML = '<div class="item-option empty-option">ไม่พบใน Master</div>';
    box.classList.add('active');
    return;
  }

  box.innerHTML = matches.map((item, index) => `
    <button type="button" class="item-option${index === 0 ? ' active' : ''}" data-code="${escapeAttr(item.itemCode)}" role="option">
      <b>${escapeHtml(item.itemCode)}</b>
      <span>${escapeHtml(item.itemName)}</span>
      <small>${escapeHtml([item.itemSize, item.uom].filter(Boolean).join(' · '))}</small>
    </button>
  `).join('');

  box.querySelectorAll('.item-option[data-code]').forEach(option => {
    option.addEventListener('mousedown', event => {
      event.preventDefault();
      const item = matches.find(row => row.itemCode === option.dataset.code);
      if (item) chooseItemSuggestion(tr, item);
    });
  });
  box.classList.add('active');
}

function handleSuggestionKeydown(event, tr) {
  const box = tr.querySelector('.item-suggestions');
  if (!box || !box.classList.contains('active')) return false;
  const options = [...box.querySelectorAll('.item-option[data-code]')];
  if (!options.length) {
    if (event.key === 'Escape') {
      closeItemSuggestions(tr);
      return true;
    }
    return false;
  }

  const current = Math.max(options.findIndex(option => option.classList.contains('active')), 0);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(current + 1, options.length - 1)
      : Math.max(current - 1, 0);
    options.forEach(option => option.classList.remove('active'));
    options[nextIndex].classList.add('active');
    options[nextIndex].scrollIntoView({ block: 'nearest' });
    return true;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    const item = getItemSuggestions(tr.querySelector('.item-code').value)[current];
    if (item) chooseItemSuggestion(tr, item);
    return true;
  }

  if (event.key === 'Escape') {
    closeItemSuggestions(tr);
    return true;
  }

  return false;
}

function chooseItemSuggestion(tr, item) {
  tr.querySelector('.item-code').value = item.itemCode || '';
  renderItemLookupResult(tr, { ...item, found: true });
  closeItemSuggestions(tr);
  const qty = tr.querySelector('.item-qty');
  if (qty) {
    qty.focus();
    qty.select();
  }
}

function closeItemSuggestions(scope) {
  const root = scope || document;
  root.querySelectorAll('.item-suggestions.active').forEach(box => {
    box.classList.remove('active');
    box.innerHTML = '';
  });
}

function pasteItemRows() {
  const raw = prompt('วางรายการจาก Excel ได้เลย\nรองรับ: รหัส Item + จำนวน + หมายเหตุ หรือคัดลอกทั้งแถวจากตารางนี้');
  if (!raw) return;

  const rows = [...document.querySelectorAll('#itemBody tr')];
  const startIndex = rows.length === 1 && isItemRowBlank(rows[0]) ? 0 : rows.length;
  applyPastedItems(parsePastedItemRows(raw), startIndex);
}

function parsePastedItemRows(raw) {
  return raw.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const tabular = line.includes('\t');
      const cells = tabular ? line.split('\t') : line.split(/\s+/);
      return normalizePastedItem(cells, tabular);
    })
    .filter(item => item.itemCode || item.qty || item.note);
}

function normalizePastedItem(cells, tabular = false) {
  const values = cells.map(value => normalizeClientText(value));
  let itemCode = values[0] || '';
  let qty = '';
  let note = '';

  if (!tabular) {
    if (values.length >= 2 && isNumericLike(values[1])) {
      itemCode = values[0] || '';
      qty = values[1] || '';
      note = values.slice(2).filter(Boolean).join(' ');
    } else if (values.length >= 2 && isNumericLike(values[values.length - 1])) {
      itemCode = values.slice(0, -1).filter(Boolean).join(' ');
      qty = values[values.length - 1] || '';
    } else {
      note = values.slice(1).filter(Boolean).join(' ');
    }
    return { itemCode, qty: normalizeQtyText(qty), note };
  }

  if (values.length >= 7 && isNumericLike(values[0])) {
    itemCode = values[1] || '';
    qty = values[5] || '';
    note = values.slice(6).filter(Boolean).join(' ');
  } else if (values.length >= 6) {
    itemCode = values[0] || '';
    qty = values[4] || '';
    note = values.slice(5).filter(Boolean).join(' ');
  } else if (values.length >= 2 && isNumericLike(values[1])) {
    itemCode = values[0] || '';
    qty = values[1] || '';
    note = values.slice(2).filter(Boolean).join(' ');
  } else if (values.length >= 2 && isNumericLike(values[values.length - 1])) {
    itemCode = values.slice(0, -1).filter(Boolean).join(' ');
    qty = values[values.length - 1] || '';
  } else {
    note = values.slice(1).filter(Boolean).join(' ');
  }

  return { itemCode, qty: normalizeQtyText(qty), note };
}

function applyPastedItems(items, startIndex) {
  if (!items.length) return toast('ไม่พบรายการที่จะวาง', 'warn');

  const body = document.getElementById('itemBody');
  items.forEach((item, offset) => {
    while (body.children.length <= startIndex + offset) addItemRow();
    fillItemRow(body.children[startIndex + offset], item);
  });

  preloadFastLookupData(currentOwnerKey, true)
    .catch(() => null)
    .finally(() => {
      items.forEach((_, offset) => {
        const tr = body.children[startIndex + offset];
        if (tr) resolveItemInput(tr, { commitBestMatch: true, silent: true });
      });
      updateItemSummary();
    });

  refreshItemNo();
  updateItemSummary();
  toast(`วางรายการแล้ว ${items.length} แถว`, 'success');
}

async function loadLatestBranchOrder() {
  const branchCode = getValue('branchCode').trim();
  if (!branchCode) {
    toast('กรุณาเลือกหรือกรอกรหัสสาขาก่อนดึงรายการล่าสุด', 'warn');
    document.getElementById('branchCode')?.focus();
    return;
  }

  setLoading(true, 'กำลังค้นหารายการล่าสุดของสาขานี้...');
  try {
    const res = await apiRequest('history', { ownerKey: currentOwnerKey, limit: 300, branchCode });
    setLoading(false);
    if (!res.ok) return toast(res.message || 'โหลดประวัติล่าสุดไม่สำเร็จ', 'error');

    const key = normalizeSearchText(branchCode);
    const branchRows = (res.rows || []).filter(row => normalizeSearchText(row.branchCode) === key);
    if (!branchRows.length) {
      return toast('ยังไม่พบประวัติการสั่งของสาขานี้ในรายการล่าสุด', 'warn');
    }

    const latestDoc = branchRows[0].documentNo;
    const latestRows = branchRows
      .filter(row => row.documentNo === latestDoc)
      .sort((a, b) => Number(a.itemNo || 0) - Number(b.itemNo || 0));

    const body = document.getElementById('itemBody');
    body.innerHTML = '';
    latestRows.forEach(row => addItemRow({
      itemCode: row.itemCode,
      qty: row.qty,
      note: row.note
    }));
    ensureItemRows(Math.max(DEFAULT_ITEM_ROWS, latestRows.length + 3));
    updateItemSummary();
    toast(`ดึงรายการล่าสุด ${latestDoc || ''} จำนวน ${latestRows.length} รายการแล้ว`, 'success');
  } catch (err) {
    setLoading(false);
    toast(err.message || err, 'error');
  }
}

function fillItemRow(tr, item) {
  tr.querySelector('.item-code').value = item.itemCode || '';
  tr.querySelector('.item-qty').value = item.qty || '';
  tr.querySelector('.item-note').value = item.note || '';
  clearItemLookupState(tr);
  tr.querySelector('.item-code').value = item.itemCode || '';
}

function isItemRowBlank(tr) {
  return !tr.querySelector('.item-code').value.trim()
    && !tr.querySelector('.item-qty').value.trim()
    && !tr.querySelector('.item-note').value.trim();
}

function isNumericLike(value) {
  return value !== '' && !isNaN(Number(String(value).replace(/,/g, '')));
}

function normalizeQtyText(value) {
  return String(value || '').replace(/,/g, '').trim();
}

function parseQty(value) {
  return Number(normalizeQtyText(value) || 0);
}

function getDuplicateItemCodes() {
  const counts = {};
  [...document.querySelectorAll('#itemBody tr')].forEach(tr => {
    const code = normalizeSearchText(tr.querySelector('.item-code').value);
    if (!code) return;
    counts[code] = (counts[code] || 0) + 1;
  });
  return Object.keys(counts).filter(code => counts[code] > 1);
}

function mergeDuplicateItems() {
  const rows = [...document.querySelectorAll('#itemBody tr')];
  const map = {};
  let merged = 0;

  rows.forEach(tr => {
    const code = normalizeSearchText(tr.querySelector('.item-code').value);
    if (!code) return;

    if (!map[code]) {
      map[code] = tr;
      return;
    }

    const target = map[code];
    const targetQty = target.querySelector('.item-qty');
    const sourceQty = tr.querySelector('.item-qty');
    const targetNote = target.querySelector('.item-note');
    const sourceNote = tr.querySelector('.item-note');
    const qty = parseQty(targetQty.value) + parseQty(sourceQty.value);
    const notes = [targetNote.value.trim(), sourceNote.value.trim()].filter(Boolean);

    targetQty.value = qty || '';
    targetNote.value = [...new Set(notes)].join(' / ');
    tr.remove();
    merged++;
  });

  ensureItemRows();
  updateItemSummary();
  if (merged) toast(`รวมรายการซ้ำแล้ว ${merged} แถว`, 'success');
  else toast('ไม่พบรายการซ้ำให้รวม', 'warn');
}

function collectItems() {
  const items = [...document.querySelectorAll('#itemBody tr')]
    .map(tr => ({
      itemCode: tr.querySelector('.item-code').value.trim(),
      qty: parseQty(tr.querySelector('.item-qty').value),
      note: tr.querySelector('.item-note').value.trim()
    }))
    .filter(item => item.itemCode || item.qty || item.note);
  updateItemSummary();
  return items;
}

function resolvePendingItemInputs() {
  [...document.querySelectorAll('#itemBody tr')].forEach(tr => {
    if (tr.querySelector('.item-code').value.trim()) {
      resolveItemInput(tr, { commitBestMatch: true, silent: true });
    }
  });
}

function findUnresolvedSearchRow() {
  return [...document.querySelectorAll('#itemBody tr')].find(tr => {
    const code = tr.querySelector('.item-code').value.trim();
    if (!code) return false;
    if (tr.dataset.itemFound === 'pending') return true;
    if (tr.dataset.itemFound === 'true') return false;
    return getItemSuggestions(code, 2).length > 0;
  });
}

function updateItemSummary() {
  const rows = [...document.querySelectorAll('#itemBody tr')];
  const activeRows = rows.filter(tr => !isItemRowBlank(tr));
  const totalQty = activeRows.reduce((sum, tr) => sum + parseQty(tr.querySelector('.item-qty').value), 0);
  const duplicateCodes = getDuplicateItemCodes();
  const issues = activeRows.filter(tr => {
    const code = tr.querySelector('.item-code').value.trim();
    const key = normalizeSearchText(code);
    return code && (
      tr.dataset.itemFound === 'pending' ||
      tr.dataset.itemFound === 'false' ||
      duplicateCodes.includes(key)
    );
  }).length;

  rows.forEach(tr => {
    const key = normalizeSearchText(tr.querySelector('.item-code').value);
    tr.classList.toggle('duplicate-row', !!key && duplicateCodes.includes(key));
  });

  setAnimatedText('itemSummaryRows', numberFmt(activeRows.length));
  setAnimatedText('itemSummaryQty', numberFmt(totalQty));
  setAnimatedText('itemSummaryIssues', numberFmt(issues));
  
  // Update floating bar values
  setAnimatedText('floatSummaryRows', numberFmt(activeRows.length));
  setAnimatedText('floatSummaryQty', numberFmt(totalQty));
  
  updateOrderHealth({ activeRows, totalQty, issues });
}

function updateOrderHealth(snapshot = null) {
  const rows = snapshot?.activeRows || [...document.querySelectorAll('#itemBody tr')].filter(tr => !isItemRowBlank(tr));
  const totalQty = snapshot?.totalQty ?? rows.reduce((sum, tr) => sum + parseQty(tr.querySelector('.item-qty')?.value), 0);
  const issues = snapshot?.issues ?? rows.filter(tr => {
    const code = tr.querySelector('.item-code')?.value.trim();
    return code && (tr.dataset.itemFound === 'pending' || tr.dataset.itemFound === 'false');
  }).length;
  const branchCode = getValue('branchCode').trim();
  const branchName = getValue('branchName').trim();
  const cycleStatus = getValue('cycleStatus').trim();
  const branchBlocked = /กรุณาเลือก|ไม่พบ|เลือกสาขา/.test(branchName);
  const branchReady = !!branchCode && !!branchName && !branchBlocked;
  const cycleReady = cycleStatus === 'รอบสั่งสาขา';
  const hasItems = rows.length > 0;
  const qtyReady = totalQty > 0;

  let score = 0;
  if (branchReady) score += 35;
  if (cycleReady) score += 20;
  else if (cycleStatus) score += 8;
  if (hasItems) score += 25;
  if (qtyReady) score += 15;
  if (hasItems && issues === 0) score += 5;
  score = Math.max(0, Math.min(100, score - Math.min(issues * 12, 36)));

  let title = 'พร้อมเริ่มกรอกคำสั่งซื้อ';
  if (!branchReady && branchCode) title = 'รอเลือกสาขาจาก Master';
  else if (!branchReady) title = 'เลือกสาขาเพื่อเริ่มคำสั่งซื้อ';
  else if (!hasItems) title = 'เพิ่มรายการสินค้าได้เลย';
  else if (issues > 0) title = 'มีรายการที่ต้องตรวจ';
  else if (cycleStatus === 'ไม่ใช่รอบสาขา') title = 'อยู่นอกรอบสั่ง';
  else if (qtyReady) title = 'พร้อมบันทึกคำสั่งซื้อ';

  setAnimatedText('orderReadinessTitle', title);
  setAnimatedText('orderReadinessScore', `${score}%`);
  setAnimatedText('floatReadinessScore', `${score}%`);
  setAnimatedText('healthBranch', branchReady ? `${branchCode} · ${truncate(branchName, 22)}` : (branchCode ? 'รอเลือก' : 'ยังไม่เลือก'));
  setAnimatedText('healthRows', numberFmt(rows.length));
  setAnimatedText('healthQty', numberFmt(totalQty));
  setAnimatedText('healthIssues', numberFmt(issues));

  const fill = document.getElementById('orderProgressFill');
  if (fill) fill.style.width = `${score}%`;

  document.getElementById('healthBranchChip')?.classList.toggle('ok', branchReady);
  document.getElementById('healthBranchChip')?.classList.toggle('warn', !!branchCode && !branchReady);
  document.getElementById('healthIssuesChip')?.classList.toggle('ok', hasItems && issues === 0);
  document.getElementById('healthIssuesChip')?.classList.toggle('warn', issues > 0);
}

function setAnimatedText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const next = String(value ?? '');
  if (el.textContent === next) return;
  el.textContent = next;
  el.classList.remove('value-pop');
  void el.offsetWidth;
  el.classList.add('value-pop');
}

async function submitOrder() {
  try {
    await preloadFastLookupData(currentOwnerKey, true);
  } catch (err) {}

  resolvePendingItemInputs();
  const unresolvedRow = findUnresolvedSearchRow();
  if (unresolvedRow) {
    toast('มีรายการที่ค้นเจอหลายตัวเลือก กรุณาเลือกรหัสสินค้าจากรายการแนะนำก่อนบันทึก', 'warn');
    const input = unresolvedRow.querySelector('.item-code');
    input.focus();
    showItemSuggestions(unresolvedRow, input.value);
    return;
  }

  const orderDate = getValue('orderDate');
  const branchCode = getValue('branchCode').trim();
  const branchEmail = getValue('branchEmail').trim();
  const branchZone = getValue('branchZone').trim();
  const items = collectItems();
  const duplicateCodes = getDuplicateItemCodes();
  const branch = getExactBranchMatch(branchCode);

  if (!orderDate) return toast('กรุณาเลือกวันที่สั่ง', 'warn');
  if (!branchCode) return toast('กรุณาระบุรหัสสาขา', 'warn');
  if (!branch) {
    document.getElementById('branchCode')?.focus();
    showBranchSuggestions(branchCode);
    return toast('กรุณาเลือกสาขาจากรายการแนะนำก่อนบันทึก', 'warn');
  }
  if (!items.length) return toast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'warn');
  if (items.find(x => !x.qty || x.qty <= 0)) return toast('จำนวนสั่งต้องมากกว่า 0 ทุก Item', 'warn');
  if (duplicateCodes.length) return toast('มีรหัสสินค้าซ้ำ กรุณากดรวมรายการซ้ำหรือแก้ไขก่อนบันทึก', 'warn');

  const ownerConfig = OWNERS[currentOwnerKey] || OWNERS['PUN'];
  const cutoffStr = ownerConfig.cutoffTime || '11:00';
  const [cutH, cutM] = cutoffStr.split(':').map(Number);
  const now = new Date();
  
  if (now.getHours() > cutH || (now.getHours() === cutH && now.getMinutes() > cutM)) {
    return toast(`ไม่สามารถส่งคำสั่งซื้อได้ เนื่องจากเลยเวลา Cut-off (${cutoffStr} น.) ของวันนี้ไปแล้ว`, 'error');
  }

  setLoading(true, 'กำลังบันทึกคำสั่งสินค้า...');

  try {
    const res = await apiRequest('submitOrder', {
      ownerKey: currentOwnerKey,
      orderDate,
      branchCode,
      branchEmail,
      branchZone,
      items
    });

    setLoading(false);
    if (!res.ok) return toast(res.message || 'บันทึกไม่สำเร็จ', 'error');

    toast(`บันทึกเรียบร้อย เลขเอกสาร ${res.result.documentNo} จำนวน ${res.result.totalItems} รายการ`, 'success');
    launchConfetti();
    document.getElementById('itemBody').innerHTML = '';
    ensureItemRows();
    validateContext();
  } catch (err) {
    setLoading(false);
    toast(err.message || err, 'error');
  }
}

/* =========================
 * Dashboard / History / Master / Logs
 * ========================= */

function loadPortalSummary() {
  if (!isAdmin()) return;
  const ownerKey = currentOwnerKey || 'PUN';

  const portalSummaryDate = document.getElementById('portalSummaryDate');
  const targetDate = portalSummaryDate ? portalSummaryDate.value : '';

  // Update the title dynamically
  const titleEl = document.getElementById('portalSummaryTitle');
  if (titleEl) {
    if (!targetDate || targetDate === todayIso()) {
      titleEl.textContent = 'ภาพรวมวันนี้';
    } else {
      const parts = targetDate.split('-');
      if (parts.length === 3) {
        titleEl.textContent = `ภาพรวมวันที่ ${parts[2]}/${parts[1]}/${parts[0]}`;
      } else {
        titleEl.textContent = `ภาพรวมวันที่ ${targetDate}`;
      }
    }
  }

  setText('portalDocCount', '-');
  setText('portalRowCount', '-');
  setText('portalQtyCount', '-');
  setText('portalBranchCount', '-');

  apiRequest('dashboard', { ownerKey, daysBack: 1, targetDate })
    .then(res => {
      if (res && res.ok && res.dashboard) {
        const d = res.dashboard;
        setAnimatedText('portalDocCount', numberFmt(d.totalDocuments || 0));
        setAnimatedText('portalRowCount', numberFmt(d.totalRows || 0));
        setAnimatedText('portalQtyCount', numberFmt(d.totalQty || 0));
        setAnimatedText('portalBranchCount', numberFmt(d.totalBranches || 0));
      } else {
        setAnimatedText('portalDocCount', '0');
        setAnimatedText('portalRowCount', '0');
        setAnimatedText('portalQtyCount', '0');
        setAnimatedText('portalBranchCount', '0');
      }
    })
    .catch(() => {
      setAnimatedText('portalDocCount', '0');
      setAnimatedText('portalRowCount', '0');
      setAnimatedText('portalQtyCount', '0');
      setAnimatedText('portalBranchCount', '0');
    });
}

function loadDashboard() {
  const ownerKey = document.getElementById('dashboardOwner')?.value || currentOwnerKey || 'PUN';
  const days = document.getElementById('dashboardDays')?.value || 30;

  apiRequest('dashboard', { ownerKey, daysBack: days })
    .then(res => {
      if (!res.ok) return toast(res.message || 'โหลด Dashboard ไม่สำเร็จ', 'error');
      renderDashboard(res.dashboard);
    })
    .catch(err => toast(err.message || err, 'error'));
}

function renderDashboard(d) {
  if (!d) return;

  const stats = [
    { icon: '📄', label: 'เอกสารทั้งหมด', value: d.totalDocuments },
    { icon: '📦', label: 'รายการสินค้า', value: d.totalRows },
    { icon: '🔢', label: 'จำนวนรวม', value: d.totalQty },
    { icon: '🏪', label: 'จำนวนสาขา', value: d.totalBranches }
  ];

  document.getElementById('dashboardStats').innerHTML = stats.map(s => `
    <div class="stat">
      <div class="icon">${s.icon}</div>
      <b class="counting" data-count="${Number(s.value || 0)}">0</b>
      <span>${s.label}</span>
    </div>
  `).join('');

  animateCounters(document.getElementById('dashboardStats'));
  renderBars('topItemsChart', d.topItems, item => item.itemName || item.itemCode, item => item.qty, 'qty');
  renderBars('statusChart', [
    { label: 'รอบสั่งสาขา', count: d.inCycle || 0 },
    { label: 'ไม่ใช่รอบสาขา', count: d.outCycle || 0 }
  ], item => item.label, item => item.count, 'รายการ');
}

function renderBars(elId, rows, labelFn, valueFn, suffix) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="empty">ยังไม่มีข้อมูล</div>';
    return;
  }

  const max = Math.max(...rows.map(valueFn), 1);
  el.innerHTML = rows.map(row => {
    const value = valueFn(row);
    const percent = Math.max((value / max) * 100, 2);
    return `
      <div class="bar-row">
        <div title="${escapeAttr(labelFn(row))}">${truncate(labelFn(row), 24)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div>
        <div><b>${numberFmt(value)}</b> ${suffix}</div>
      </div>
    `;
  }).join('');
}

function loadCycleExport() {
  const ownerKey = document.getElementById('exportOwner')?.value || currentOwnerKey || 'PUN';
  const cycleDate = document.getElementById('exportCycleDate')?.value || todayIso();
  if (!cycleDate) return toast('กรุณาเลือกวันที่รอบสั่ง', 'warn');
  currentOwnerKey = ownerKey;
  applyOwnerStyle(ownerKey);

  setLoading(true, 'กำลังคัดข้อมูลตามรอบสั่ง...');

  apiRequest('cycleExport', { ownerKey, cycleDate })
    .then(res => {
      setLoading(false);
      if (!res.ok) return toast(res.message || 'เตรียมข้อมูล Export ไม่สำเร็จ', 'error');
      renderCycleExport(res.export);
    })
    .catch(err => {
      setLoading(false);
      toast(err.message || err, 'error');
    });
}

function renderCycleExport(data) {
  lastCycleExport = data || null;
  if (!data) return;

  const readyRows = data.readyRows || [];
  const issueRows = data.issueRows || [];
  const stats = [
    { icon: '⬇', label: 'พร้อม Export', value: readyRows.length },
    { icon: '⚠', label: 'ต้องตรวจ', value: issueRows.length },
    { icon: '⌚', label: `Cut-off ${data.cutoffTime || '-'}`, value: data.lateRows || 0 },
    { icon: '📦', label: 'จำนวนรวม', value: data.totalQty || 0 }
  ];

  document.getElementById('exportStats').innerHTML = stats.map(s => `
    <div class="stat">
      <div class="icon">${s.icon}</div>
      <b>${numberFmt(s.value)}</b>
      <span>${escapeHtml(s.label)}</span>
    </div>
  `).join('');

  setText(
    'exportReadyHint',
    `${data.ownerLabel || data.owner} · วันที่รอบสั่ง ${data.cycleDate} (${data.cycleDay || '-'}) · Cut-off ${data.cutoffTime || '-'}`
  );

  const readyBody = document.getElementById('exportReadyBody');
  if (readyBody) {
    if (!readyRows.length) {
      readyBody.innerHTML = '<tr><td colspan="7"><div class="empty">ยังไม่มีรายการที่พร้อม Export</div></td></tr>';
    } else {
      readyBody.innerHTML = readyRows.slice(0, 80).map(row => `
        <tr>
          <td><b>${escapeHtml(row.documentNo)}</b></td>
          <td>${escapeHtml(row.branchCode)}</td>
          <td>${escapeHtml(row.branchName)}</td>
          <td>${escapeHtml(row.itemCode)}</td>
          <td>${escapeHtml(row.itemName)}</td>
          <td><b>${escapeHtml(row.qty)}</b></td>
          <td>${escapeHtml(row.submittedAt)}</td>
        </tr>
      `).join('');
    }
  }

  const issueBody = document.getElementById('exportIssueBody');
  if (issueBody) {
    if (!issueRows.length) {
      issueBody.innerHTML = '<tr><td colspan="6"><div class="empty">ไม่พบรายการติดปัญหา</div></td></tr>';
    } else {
      issueBody.innerHTML = issueRows.slice(0, 80).map(row => `
        <tr>
          <td>${(row.issues || []).map(issue => `<span class="badge warn">${escapeHtml(issue)}</span>`).join(' ')}</td>
          <td><b>${escapeHtml(row.documentNo)}</b></td>
          <td>${escapeHtml(row.branchCode)}</td>
          <td>${escapeHtml(row.itemCode)}</td>
          <td><b>${escapeHtml(row.qty)}</b></td>
          <td>${escapeHtml(row.submittedAt)}</td>
        </tr>
      `).join('');
    }
  }
}

function downloadCycleExportCsv() {
  if (!lastCycleExport) return toast('กรุณากด Preview ก่อนดาวน์โหลด', 'warn');
  const rows = lastCycleExport.readyRows || [];
  if (!rows.length) return toast('ยังไม่มีรายการที่พร้อม Export', 'warn');

  downloadCsv(
    lastCycleExport.exportHeaders || [],
    rows.map(row => row.exportValues || []),
    buildCycleExportFileName('ready')
  );
}

function downloadCycleIssueCsv() {
  if (!lastCycleExport) return toast('กรุณากด Preview ก่อนดาวน์โหลด', 'warn');
  const rows = lastCycleExport.issueRows || [];
  if (!rows.length) return toast('ไม่มีรายการติดปัญหาให้ดาวน์โหลด', 'warn');

  downloadCsv(
    ['ปัญหา', ...(lastCycleExport.exportHeaders || [])],
    rows.map(row => [(row.issues || []).join(' | '), ...(row.exportValues || [])]),
    buildCycleExportFileName('issues')
  );
}

function buildCycleExportFileName(type) {
  const data = lastCycleExport || {};
  return `${data.owner || 'OWNER'}_${data.cycleDate || todayIso()}_${type}_export.csv`;
}

function downloadCsv(headers, rows, filename) {
  const lines = [headers, ...rows].map(row => row.map(csvCell).join(','));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`ดาวน์โหลด ${filename} แล้ว`, 'success');
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function loadHistory() {
  const ownerKey = document.getElementById('historyOwner')?.value || currentOwnerKey || 'PUN';
  setLoading(true, 'กำลังโหลดประวัติ...');

  apiRequest('history', { ownerKey, limit: 100 })
    .then(res => {
      setLoading(false);
      if (!res.ok) return toast(res.message || 'โหลดประวัติไม่สำเร็จ', 'error');

      const body = document.getElementById('historyBody');
      if (!res.rows.length) {
        body.innerHTML = '<tr><td colspan="13"><div class="empty">ยังไม่มีข้อมูล</div></td></tr>';
        return;
      }

      body.innerHTML = res.rows.map(r => `
        <tr>
          <td>${escapeHtml(r.orderDate)}</td>
          <td><b>${escapeHtml(r.documentNo)}</b></td>
          <td>${escapeHtml(r.branchCode)}</td>
          <td>${escapeHtml(r.branchName)}</td>
          <td>${escapeHtml(r.branchZone)}</td>
          <td>${escapeHtml(r.itemNo)}</td>
          <td>${escapeHtml(r.itemCode)}</td>
          <td>${escapeHtml(r.itemName)}</td>
          <td>${escapeHtml(r.itemSize)}</td>
          <td>${escapeHtml(r.uom)}</td>
          <td>${escapeHtml(r.qty)}</td>
          <td>${escapeHtml(r.note)}</td>
          <td>${cycleBadge(r.cycleStatus)}</td>
        </tr>
      `).join('');
    })
    .catch(err => {
      setLoading(false);
      toast(err.message || err, 'error');
    });
}

function searchMasterItems() {
  const ownerKey = document.getElementById('masterOwner')?.value || currentOwnerKey || 'PUN';
  const keyword = document.getElementById('masterKeyword')?.value || '';

  apiRequest('searchMasterItems', { ownerKey, keyword, limit: 50 })
    .then(res => {
      if (!res.ok) return toast(res.message || 'ค้นหา Master ไม่สำเร็จ', 'error');

      const body = document.getElementById('masterBody');
      if (!res.rows.length) {
        body.innerHTML = '<tr><td colspan="4"><div class="empty">ไม่พบข้อมูล</div></td></tr>';
        return;
      }

      body.innerHTML = res.rows.map(r => `
        <tr data-code="${escapeAttr(r.itemCode)}" data-name="${escapeAttr(r.itemName)}" data-size="${escapeAttr(r.itemSize || '')}" data-uom="${escapeAttr(r.uom || '')}" onclick="pickMasterItemFromRow(this)" style="cursor:pointer;">
          <td><b>${escapeHtml(r.itemCode)}</b></td>
          <td>${escapeHtml(r.itemName)}</td>
          <td>${escapeHtml(r.itemSize || '')}</td>
          <td>${escapeHtml(r.uom || '')}</td>
        </tr>
      `).join('');
    })
    .catch(err => toast(err.message || err, 'error'));
}

function debouncedSearchMasterItems() {
  clearTimeout(masterTimer);
  masterTimer = setTimeout(searchMasterItems, 350);
}

function pickMasterItemFromRow(row) {
  setValue('masterItemCode', row.dataset.code || '');
  setValue('masterItemName', row.dataset.name || '');
  setValue('masterItemSize', row.dataset.size || '');
  setValue('masterItemUom', row.dataset.uom || '');
}

function upsertMasterItem() {
  const ownerKey = getValue('masterOwner');
  const itemCode = getValue('masterItemCode').trim();
  const itemName = getValue('masterItemName').trim();
  const itemSize = getValue('masterItemSize').trim();
  const uom = getValue('masterItemUom').trim();

  if (!itemCode) return toast('กรุณาระบุรหัส Item', 'warn');
  if (!itemName) return toast('กรุณาระบุชื่อ Item', 'warn');

  setLoading(true, 'กำลังบันทึก Master Item...');

  apiRequest('upsertMasterItem', {
    ownerKey,
    item: { itemCode, itemName, itemSize, uom }
  })
    .then(res => {
      setLoading(false);
      if (!res.ok) return toast(res.message || 'บันทึก Master ไม่สำเร็จ', 'error');
      delete FAST_LOOKUP[ownerKey];
      toast(res.message, 'success');
      searchMasterItems();
    })
    .catch(err => {
      setLoading(false);
      toast(err.message || err, 'error');
    });
}

function loadLogs() {
  setLoading(true, 'กำลังโหลด Logs...');

  apiRequest('logs', { limit: 80 })
    .then(res => {
      setLoading(false);
      if (!res.ok) return toast(res.message || 'โหลด Logs ไม่สำเร็จ', 'error');

      const body = document.getElementById('logsBody');
      if (!res.rows.length) {
        body.innerHTML = '<tr><td colspan="7"><div class="empty">ยังไม่มี Logs</div></td></tr>';
        return;
      }

      body.innerHTML = res.rows.map(r => `
        <tr>
          <td>${escapeHtml(r.timestamp)}</td>
          <td><b>${escapeHtml(r.action)}</b></td>
          <td>${escapeHtml(r.owner)}</td>
          <td>${escapeHtml(r.documentNo)}</td>
          <td>${escapeHtml(r.branchCode)}</td>
          <td>${escapeHtml(r.details)}</td>
          <td>${escapeHtml(r.userEmail)}</td>
        </tr>
      `).join('');
    })
    .catch(err => {
      setLoading(false);
      toast(err.message || err, 'error');
    });
}

/* =========================
 * Client Helpers
 * ========================= */

function buildDocumentNoClient(branchCode, orderDate) {
  const parts = String(orderDate || '').split('-');
  if (parts.length !== 3) return '';
  const yy = parts[0].slice(-2);
  return `GQ-${normalizeClientText(branchCode).toUpperCase()}-T${yy}${parts[1]}${parts[2]}`;
}

function checkOrderCycleClient(orderDate, cycleText) {
  const parts = String(orderDate || '').split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayShort = dayMap[d.getDay()] || '';
  const dayThai = getThaiDayClient(dayShort);
  const days = extractCycleDaysClient(cycleText);
  const matched = days.includes(dayShort);
  return {
    status: matched ? 'รอบสั่งสาขา' : 'ไม่ใช่รอบสาขา',
    dayShort,
    dayThai,
    cycleDays: days
  };
}

function extractCycleDaysClient(text) {
  const raw = normalizeClientText(text)
    .toLowerCase()
    .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
    .replace(/[，、;；/\\|]+/g, ',')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return [];

  const defs = [
    { key: 'Mon', patterns: [/\bmonday\b/g, /\bmon\.?\b/g, /วันจันทร์/g, /จันทร์/g] },
    { key: 'Tue', patterns: [/\btuesday\b/g, /\btue\.?\b/g, /วันอังคาร/g, /อังคาร/g] },
    { key: 'Wed', patterns: [/\bwednesday\b/g, /\bwed\.?\b/g, /วันพุธ/g, /พุธ/g] },
    { key: 'Thu', patterns: [/\bthursday\b/g, /\bthu\.?\b/g, /วันพฤหัสบดี/g, /พฤหัสบดี/g, /พฤหัส/g] },
    { key: 'Fri', patterns: [/\bfriday\b/g, /\bfri\.?\b/g, /วันศุกร์/g, /ศุกร์/g] },
    { key: 'Sat', patterns: [/\bsaturday\b/g, /\bsat\.?\b/g, /วันเสาร์/g, /เสาร์/g] },
    { key: 'Sun', patterns: [/\bsunday\b/g, /\bsun\.?\b/g, /วันอาทิตย์/g, /อาทิตย์/g] }
  ];

  const found = [];
  defs.forEach(def => {
    const ok = def.patterns.some(pattern => {
      pattern.lastIndex = 0;
      return pattern.test(raw);
    });
    if (ok && !found.includes(def.key)) found.push(def.key);
  });
  return found;
}

function getThaiDayClient(dayShort) {
  return {
    Mon: 'จันทร์', Tue: 'อังคาร', Wed: 'พุธ', Thu: 'พฤหัสบดี',
    Fri: 'ศุกร์', Sat: 'เสาร์', Sun: 'อาทิตย์'
  }[dayShort] || dayShort;
}

function cycleBadge(text) {
  if (text === 'รอบสั่งสาขา') return '<span class="badge green">รอบสั่งสาขา</span>';
  if (text === 'ไม่ใช่รอบสาขา') return '<span class="badge danger">ไม่ใช่รอบสาขา</span>';
  return escapeHtml(text || '');
}

function setLoading(active, text) {
  const loading = document.getElementById('loading');
  if (!loading) return;
  loading.classList.toggle('active', !!active);
  setText('loadingText', text || 'กำลังประมวลผล...');
}

function toast(message, type = '') {
  const stack = document.getElementById('toastStack');
  if (!stack) return alert(message);
  const kind = ['success', 'error', 'warn'].includes(type) ? type : 'info';
  const meta = {
    success: { icon: '✓', label: 'สำเร็จ' },
    error: { icon: '!', label: 'เกิดข้อผิดพลาด' },
    warn: { icon: '!', label: 'แจ้งเตือน' },
    info: { icon: 'i', label: 'สถานะ' }
  }[kind];
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${meta.icon}</span>
    <span class="toast-copy"><b>${meta.label}</b><span>${escapeHtml(message)}</span></span>
    <button class="toast-close" type="button" aria-label="ปิด">×</button>
  `;
  stack.appendChild(el);
  const timer = setTimeout(() => dismissToast(el), 4600);
  el.querySelector('.toast-close')?.addEventListener('click', () => {
    clearTimeout(timer);
    dismissToast(el);
  });
}

function dismissToast(el) {
  if (!el || el.classList.contains('leaving')) return;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 220);
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function numberFmt(n) {
  return Number(n || 0).toLocaleString('th-TH');
}

function truncate(text, len) {
  text = String(text || '');
  return text.length > len ? text.slice(0, len - 1) + '…' : text;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', ' ');
}

function normalizeClientText(value) {
  return String(value ?? '').trim();
}

function normalizeSearchText(value) {
  return normalizeClientText(value).toLowerCase();
}

function getValue(id) {
  return document.getElementById(id)?.value || '';
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/* =========================
 * Motion
 * ========================= */

function armMotionEffects() {
  document.body.classList.add('motion-ready');
  animateVisibleCards('home');

  let rippleFrame = null;
  let rippleTarget = null;
  let rippleX = 0;
  let rippleY = 0;

  document.addEventListener('pointermove', event => {
    const target = event.target.closest && event.target.closest('.btn');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    rippleTarget = target;
    rippleX = event.clientX - rect.left;
    rippleY = event.clientY - rect.top;

    if (rippleFrame) return;
    rippleFrame = requestAnimationFrame(() => {
      if (rippleTarget) {
        rippleTarget.style.setProperty('--rx', `${rippleX}px`);
        rippleTarget.style.setProperty('--ry', `${rippleY}px`);
      }
      rippleFrame = null;
    });
  }, { passive: true });
}

function animateVisibleCards(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const targets = Array.from(section.querySelectorAll('.hero, .portal-header, .app-card, .card, .stat'));

  targets.forEach(el => {
    el.classList.remove('animate-hit');
    el.style.animationDelay = '0ms';
  });

  requestAnimationFrame(() => {
    targets.forEach((el, index) => {
      el.style.animationDelay = `${index * 30}ms`;
      el.classList.add('animate-hit');
    });
  });
}

function flashLookupRow(tr, ok) {
  const inputs = tr.querySelectorAll('.item-name, .item-size, .item-uom');
  inputs.forEach(input => {
    input.classList.remove('lookup-flash-ok', 'lookup-flash-bad');
    void input.offsetWidth;
    input.classList.add(ok ? 'lookup-flash-ok' : 'lookup-flash-bad');
    setTimeout(() => input.classList.remove('lookup-flash-ok', 'lookup-flash-bad'), 1080);
  });
}

function animateCounters(root) {
  if (!root) return;
  const counters = root.querySelectorAll('[data-count]');
  counters.forEach(counter => {
    const target = Number(counter.dataset.count || 0);
    const start = performance.now();
    const duration = 900;

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      counter.textContent = numberFmt(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
      else counter.textContent = numberFmt(target);
    }

    requestAnimationFrame(tick);
  });
}

function launchConfetti() {
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  const colors = [
    getComputedStyle(document.documentElement).getPropertyValue('--owner').trim() || '#5b371f',
    getComputedStyle(document.documentElement).getPropertyValue('--owner-accent').trim() || '#1f8f4d',
    '#22c55e', '#f59e0b', '#38bdf8', '#ffffff'
  ];

  for (let i = 0; i < 30; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--x', `${(Math.random() - .5) * 240}px`);
    piece.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    piece.style.setProperty('--fall', `${1.55 + Math.random() * 1.45}s`);
    piece.style.animationDelay = `${Math.random() * .18}s`;
    layer.appendChild(piece);
  }

  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2800);
}

/* =========================================================
 * Real-time Clock & Cut-off Warning
 * ========================================================= */
function startRealtimeClock() {
  const clockEl = document.getElementById('globalClock');
  if (!clockEl) return;
  clockEl.style.display = 'flex';

  function updateClock() {
    const now = new Date();
    
    // Format date and time
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    // Get current owner's cutoff time
    const owner = OWNERS[currentOwnerKey] || OWNERS['PUN'];
    const cutoffStr = owner.cutoffTime || '11:00';
    const [cutH, cutM] = cutoffStr.split(':').map(Number);
    
    const cutoffTime = new Date();
    cutoffTime.setHours(cutH, cutM, 0, 0);
    
    // Calculate difference
    const diffMs = cutoffTime - now;
    const diffMinutes = Math.floor(diffMs / 60000);
    
    let isWarning = false;
    let warningText = '';
    
    // Warning if within 30 minutes before cut-off
    if (diffMinutes >= 0 && diffMinutes <= 30) {
      isWarning = true;
      warningText = `<span style="font-size:12px; margin-left:6px; opacity:0.9;">(ใกล้ Cut-off: ${cutoffStr} น.)</span>`;
    } else if (diffMinutes < 0 && now.getHours() < 20) {
      warningText = `<span style="font-size:12px; margin-left:6px; opacity:0.6;">(เลยเวลา Cut-off วันนี้)</span>`;
    }

    if (isWarning) {
      clockEl.classList.add('warn');
    } else {
      clockEl.classList.remove('warn');
    }

    clockEl.innerHTML = `📅 ${day}/${month}/${year} 🕒 <b>${hours}:${minutes}:${seconds}</b> ${warningText}`;
  }

  updateClock();
  setInterval(updateClock, 1000);
}
