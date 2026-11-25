const BASE_TITLE = 'DmCare Inbox — รวมแชท LINE (a1–a5) & Facebook (b1–b5)';

const state = {
  clientId: (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  brandName: 'DmCare',
  isProduction: false,
  dbEngine: 'sqlite',
  storageProvider: 'local-disk',
  channels: [],
  agents: [],
  quickReplies: [],
  campaigns: [],
  geminiEnabled: false,
  liveDeliveryEnabled: false,
  publicBaseUrl: '',
  currentUser: null,
  editingAgentId: null,
  editingChannelId: null,
  sseSource: null,
  presence: {}, // { [conversationId]: [{ clientId, agentId, agentName, isTyping }] }
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  activeMessages: [],
  activeSubmissions: [],
  selectedEvidenceUrls: new Set(),
  simImageUrls: [],
  pendingImage: null, // { url, filename }
  qrModalImage: null, // { url, filename }
  editingQrId: null, // null = create mode, string = edit mode
  slashMatches: [],
  slashSelectedIndex: 0,
  soundEnabled: localStorage.getItem('omnichat_sound') !== 'off',
  filter: {
    platform: 'all',
    channelId: 'all',
    box: 'unreplied',
    q: '',
  },
  counts: {
    unreplied: 0,
    pending: 0,
    replied: 0,
    resolved: 0,
    all: 0,
  },
  currentAgentId: 'agent_1',
};

const timeFormatter = new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit',
  minute: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('th-TH', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const els = {
  loginScreen: document.getElementById('loginScreen'),
  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginErrorBox: document.getElementById('loginErrorBox'),
  loginSubmitBtn: document.getElementById('loginSubmitBtn'),
  loginDemoBox: document.getElementById('loginDemoBox'),
  openSimulatorBtn: document.getElementById('openSimulatorBtn'),
  chatEmptyHint: document.getElementById('chatEmptyHint'),
  appShell: document.getElementById('appShell'),
  sseStatus: document.getElementById('sseStatus'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  totalUnreadBadge: document.getElementById('totalUnreadBadge'),
  lineUnreadBadge: document.getElementById('lineUnreadBadge'),
  fbUnreadBadge: document.getElementById('fbUnreadBadge'),
  lineChannelList: document.getElementById('lineChannelList'),
  fbChannelList: document.getElementById('fbChannelList'),
  userAvatarBadge: document.getElementById('userAvatarBadge'),
  userDisplayName: document.getElementById('userDisplayName'),
  userRoleLabel: document.getElementById('userRoleLabel'),
  openAgentsBtn: document.getElementById('openAgentsBtn'),
  openChangePwBtn: document.getElementById('openChangePwBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  openManageChannelsBtn: document.getElementById('openManageChannelsBtn'),
  openAddChannelBtn: document.getElementById('openAddChannelBtn'),
  searchInput: document.getElementById('searchInput'),
  pendingFolderTab: document.getElementById('pendingFolderTab'),
  tabCountUnreplied: document.getElementById('tabCountUnreplied'),
  tabCountPending: document.getElementById('tabCountPending'),
  tabCountReplied: document.getElementById('tabCountReplied'),
  tabCountResolved: document.getElementById('tabCountResolved'),
  tabCountAll: document.getElementById('tabCountAll'),
  unreadAlertBar: document.getElementById('unreadAlertBar'),
  lineNotifyBtn: document.getElementById('lineNotifyBtn'),
  lineNotifyCount: document.getElementById('lineNotifyCount'),
  fbNotifyBtn: document.getElementById('fbNotifyBtn'),
  fbNotifyCount: document.getElementById('fbNotifyCount'),
  conversationList: document.getElementById('conversationList'),
  chatEmptyState: document.getElementById('chatEmptyState'),
  chatWorkspace: document.getElementById('chatWorkspace'),
  chatCustomerAvatar: document.getElementById('chatCustomerAvatar'),
  chatCustomerName: document.getElementById('chatCustomerName'),
  chatChannelPill: document.getElementById('chatChannelPill'),
  chatPolicyBanner: document.getElementById('chatPolicyBanner'),
  escalateBtn: document.getElementById('escalateBtn'),
  assignAgentSelect: document.getElementById('assignAgentSelect'),
  convStatusSelect: document.getElementById('convStatusSelect'),
  closeChatBtn: document.getElementById('closeChatBtn'),
  collisionBanner: document.getElementById('collisionBanner'),
  messageList: document.getElementById('messageList'),
  jumpNewMsgBtn: document.getElementById('jumpNewMsgBtn'),
  jumpNewMsgDot: document.getElementById('jumpNewMsgDot'),
  jumpNewMsgText: document.getElementById('jumpNewMsgText'),
  dropOverlay: document.getElementById('dropOverlay'),
  qrPreviewPopover: document.getElementById('qrPreviewPopover'),
  qrPreviewTitle: document.getElementById('qrPreviewTitle'),
  qrPreviewImg: document.getElementById('qrPreviewImg'),
  qrPreviewText: document.getElementById('qrPreviewText'),
  quickReplyBar: document.getElementById('quickReplyBar'),
  openManageQuickReplyBtn: document.getElementById('openManageQuickReplyBtn'),
  openAddQuickReplyBtn: document.getElementById('openAddQuickReplyBtn'),
  slashMenu: document.getElementById('slashMenu'),
  pendingImagePreview: document.getElementById('pendingImagePreview'),
  pendingImageThumb: document.getElementById('pendingImageThumb'),
  pendingImageName: document.getElementById('pendingImageName'),
  cancelPendingImageBtn: document.getElementById('cancelPendingImageBtn'),
  replyForm: document.getElementById('replyForm'),
  imageFileInput: document.getElementById('imageFileInput'),
  attachImageBtn: document.getElementById('attachImageBtn'),
  replyInput: document.getElementById('replyInput'),
  infoPanel: document.getElementById('infoPanel'),
  aiProviderBadge: document.getElementById('aiProviderBadge'),
  verifyCampaignSelect: document.getElementById('verifyCampaignSelect'),
  evidenceSelectedCount: document.getElementById('evidenceSelectedCount'),
  evidenceThumbGrid: document.getElementById('evidenceThumbGrid'),
  mockAiScenarioSelect: document.getElementById('mockAiScenarioSelect'),
  runAiVerifyBtn: document.getElementById('runAiVerifyBtn'),
  runManualFallbackBtn: document.getElementById('runManualFallbackBtn'),
  aiVerdictContainer: document.getElementById('aiVerdictContainer'),
  infoCustomerName: document.getElementById('infoCustomerName'),
  infoExternalUserId: document.getElementById('infoExternalUserId'),
  infoChannelName: document.getElementById('infoChannelName'),
  infoWebhookUrl: document.getElementById('infoWebhookUrl'),
  infoTagsContainer: document.getElementById('infoTagsContainer'),
  addTagForm: document.getElementById('addTagForm'),
  newTagInput: document.getElementById('newTagInput'),
  customerNotesInput: document.getElementById('customerNotesInput'),
  saveNotesBtn: document.getElementById('saveNotesBtn'),
  simulatorDialog: document.getElementById('simulatorDialog'),
  simulatorForm: document.getElementById('simulatorForm'),
  simChannelSelect: document.getElementById('simChannelSelect'),
  simCustomerName: document.getElementById('simCustomerName'),
  simExternalUserId: document.getElementById('simExternalUserId'),
  simMessageText: document.getElementById('simMessageText'),
  simImageFilesInput: document.getElementById('simImageFilesInput'),
  simPickImagesBtn: document.getElementById('simPickImagesBtn'),
  simGen2ProofsBtn: document.getElementById('simGen2ProofsBtn'),
  simClearImagesBtn: document.getElementById('simClearImagesBtn'),
  simImagePreviewList: document.getElementById('simImagePreviewList'),
  addChannelDialog: document.getElementById('addChannelDialog'),
  addChannelForm: document.getElementById('addChannelForm'),
  addQuickReplyDialog: document.getElementById('addQuickReplyDialog'),
  addQuickReplyForm: document.getElementById('addQuickReplyForm'),
  qrModalHeading: document.getElementById('qrModalHeading'),
  qrSubmitBtn: document.getElementById('qrSubmitBtn'),
  qrChannelSelect: document.getElementById('qrChannelSelect'),
  qrShortcutInput: document.getElementById('qrShortcutInput'),
  qrTitleInput: document.getElementById('qrTitleInput'),
  qrContentInput: document.getElementById('qrContentInput'),
  qrImageFileInput: document.getElementById('qrImageFileInput'),
  qrAttachImageBtn: document.getElementById('qrAttachImageBtn'),
  qrImageStatus: document.getElementById('qrImageStatus'),
  qrRemoveImageBtn: document.getElementById('qrRemoveImageBtn'),
  qrModalPreviewImg: document.getElementById('qrModalPreviewImg'),
  qrModalPreviewText: document.getElementById('qrModalPreviewText'),
  manageQuickRepliesDialog: document.getElementById('manageQuickRepliesDialog'),
  qrManageScopeSelect: document.getElementById('qrManageScopeSelect'),
  qrManageAddNewBtn: document.getElementById('qrManageAddNewBtn'),
  qrManageList: document.getElementById('qrManageList'),
  campaignsDialog: document.getElementById('campaignsDialog'),
  openCampaignsBtn: document.getElementById('openCampaignsBtn'),
  campManageSelect: document.getElementById('campManageSelect'),
  toggleNewCampBtn: document.getElementById('toggleNewCampBtn'),
  newCampaignForm: document.getElementById('newCampaignForm'),
  cancelNewCampBtn: document.getElementById('cancelNewCampBtn'),
  newCampName: document.getElementById('newCampName'),
  newCampMinConf: document.getElementById('newCampMinConf'),
  newCampRules: document.getElementById('newCampRules'),
  newCampTemplate: document.getElementById('newCampTemplate'),
  statAvailable: document.getElementById('statAvailable'),
  statClaimed: document.getElementById('statClaimed'),
  statTotal: document.getElementById('statTotal'),
  xlsFileInput: document.getElementById('xlsFileInput'),
  uploadXlsBtn: document.getElementById('uploadXlsBtn'),
  exportXlsLink: document.getElementById('exportXlsLink'),
  pasteCodesInput: document.getElementById('pasteCodesInput'),
  importPastedCodesBtn: document.getElementById('importPastedCodesBtn'),
  voucherTableBody: document.getElementById('voucherTableBody'),
  changePwDialog: document.getElementById('changePwDialog'),
  changePwForm: document.getElementById('changePwForm'),
  curPwInput: document.getElementById('curPwInput'),
  newPwInput: document.getElementById('newPwInput'),
  agentsDialog: document.getElementById('agentsDialog'),
  openNewAgentFormBtn: document.getElementById('openNewAgentFormBtn'),
  agentEditorForm: document.getElementById('agentEditorForm'),
  agentEditorTitle: document.getElementById('agentEditorTitle'),
  agNameInput: document.getElementById('agNameInput'),
  agEmailInput: document.getElementById('agEmailInput'),
  agPasswordInput: document.getElementById('agPasswordInput'),
  agPwHint: document.getElementById('agPwHint'),
  agRoleSelect: document.getElementById('agRoleSelect'),
  agShopsSection: document.getElementById('agShopsSection'),
  agShopCheckboxes: document.getElementById('agShopCheckboxes'),
  cancelAgentEditorBtn: document.getElementById('cancelAgentEditorBtn'),
  agentsListContainer: document.getElementById('agentsListContainer'),
  manageChannelsDialog: document.getElementById('manageChannelsDialog'),
  liveEnvBanner: document.getElementById('liveEnvBanner'),
  editChannelForm: document.getElementById('editChannelForm'),
  editChannelHeading: document.getElementById('editChannelHeading'),
  editChName: document.getElementById('editChName'),
  editChExternalId: document.getElementById('editChExternalId'),
  editChAccessToken: document.getElementById('editChAccessToken'),
  editChSecretWrap: document.getElementById('editChSecretWrap'),
  editChSecret: document.getElementById('editChSecret'),
  cancelEditChannelBtn: document.getElementById('cancelEditChannelBtn'),
  manageChannelsList: document.getElementById('manageChannelsList'),
  lightboxDialog: document.getElementById('lightboxDialog'),
  lightboxImg: document.getElementById('lightboxImg'),
  toast: document.getElementById('toast'),
};

// -----------------------------------------------------------------------------
// API & Toast Helpers
// -----------------------------------------------------------------------------
async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    showLoginScreen('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    throw new Error(data.error || 'กรุณาเข้าสู่ระบบ');
  }
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

let toastTimer;
function showToast(msg, { platform = null, onClick = null } = {}) {
  els.toast.replaceChildren();
  if (platform) {
    const dot = document.createElement('span');
    dot.className = `notify-dot ${platform}`;
    els.toast.append(dot);
  }
  const textNode = document.createElement('span');
  textNode.textContent = msg;
  els.toast.append(textNode);

  els.toast.classList.toggle('clickable', typeof onClick === 'function');
  els.toast.onclick = typeof onClick === 'function'
    ? () => {
        els.toast.classList.add('hidden');
        onClick();
      }
    : null;

  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 4200);
}

// -----------------------------------------------------------------------------
// 1. Web Audio Notification Sound + Browser Tab Title
// -----------------------------------------------------------------------------
let audioCtx = null;

function playNotificationSound(platform = 'line') {
  if (!state.soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    const now = audioCtx.currentTime;
    const notes = platform === 'line' ? [880, 1174.66] : [659.25, 987.77];

    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);

      gain.gain.setValueAtTime(0.001, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.09 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.09 + 0.22);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.24);
    });
  } catch {
    // Browser autoplay policies may block sound before first user interaction
  }
}

function updateSoundButtonUI() {
  els.soundToggleBtn.textContent = state.soundEnabled ? '🔔' : '🔕';
  els.soundToggleBtn.className = `sound-btn ${state.soundEnabled ? 'on' : 'off'}`;
  els.soundToggleBtn.setAttribute('aria-pressed', String(state.soundEnabled));
  els.soundToggleBtn.title = state.soundEnabled
    ? 'เสียงแจ้งเตือน: เปิดอยู่ (คลิกเพื่อปิด)'
    : 'เสียงแจ้งเตือน: ปิดอยู่ (คลิกเพื่อเปิด)';
}

function updateTabTitle(totalUnread) {
  document.title = totalUnread > 0 ? `(${totalUnread}) ${BASE_TITLE}` : BASE_TITLE;
}

// -----------------------------------------------------------------------------
// 2. Collision Detection (Presence & Typing Sync)
// -----------------------------------------------------------------------------
let typingIdleTimer = null;

async function reportPresence({ conversationId = state.activeConversationId, isTyping = false } = {}) {
  try {
    await api('/api/presence', {
      method: 'POST',
      body: JSON.stringify({
        clientId: state.clientId,
        agentId: state.currentAgentId,
        conversationId: conversationId || null,
        isTyping: Boolean(isTyping),
      }),
    });
  } catch {
    // Non-critical background sync
  }
}

function getOtherViewers(conversationId) {
  const list = state.presence[conversationId] || [];
  return list.filter((p) => p.clientId !== state.clientId);
}

function renderCollisionBanner() {
  if (!state.activeConversationId) {
    els.collisionBanner.classList.add('hidden');
    return;
  }
  const others = getOtherViewers(state.activeConversationId);
  if (others.length === 0) {
    els.collisionBanner.classList.add('hidden');
    return;
  }

  const typingAgents = others.filter((o) => o.isTyping).map((o) => o.agentName);
  const viewingAgents = others.filter((o) => !o.isTyping).map((o) => o.agentName);

  const parts = [];
  if (typingAgents.length > 0) {
    parts.push(`✍️ ${[...new Set(typingAgents)].join(', ')} กำลังพิมพ์ตอบลูกค้าในห้องนี้อยู่!`);
  }
  if (viewingAgents.length > 0) {
    parts.push(`👁 ${[...new Set(viewingAgents)].join(', ')} กำลังเปิดดูห้องแชทนี้อยู่`);
  }

  els.collisionBanner.textContent = `⚠️ ${parts.join(' · ')} (ระวังตอบชนกัน)`;
  els.collisionBanner.classList.remove('hidden');
}

// -----------------------------------------------------------------------------
// 3. SLA Wait Timer Helper
// -----------------------------------------------------------------------------
function getSlaInfo(conv) {
  if (conv.is_replied || conv.status === 'resolved') return null;
  const refIso = conv.last_customer_msg_at || conv.last_message_at;
  if (!refIso) return null;

  const diffMin = Math.max(0, Math.floor((Date.now() - Date.parse(refIso)) / 60_000));
  if (diffMin < 1) {
    return { level: 'ok', label: 'รอ <1 นาที' };
  }
  if (diffMin < 5) {
    return { level: 'ok', label: `รอ ${diffMin} นาที` };
  }
  if (diffMin < 15) {
    return { level: 'warn', label: `⏱ รอ ${diffMin} นาที` };
  }
  if (diffMin < 60) {
    return { level: 'urgent', label: `🔥 รอ ${diffMin} นาที` };
  }
  const hours = Math.floor(diffMin / 60);
  return { level: 'urgent', label: `🔥 รอ ${hours} ชม.+` };
}

// -----------------------------------------------------------------------------
// 4. Image Upload, Drag & Drop, Paste & Lightbox
// -----------------------------------------------------------------------------
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

async function handleImageFile(file) {
  if (!file || !state.activeConversationId) return;
  if (!file.type.startsWith('image/')) {
    showToast('รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, WEBP, GIF)');
    return;
  }
  try {
    showToast('กำลังอัปโหลดรูปภาพ...');
    const dataUrl = await fileToDataUrl(file);
    const uploaded = await api('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    });
    state.pendingImage = {
      url: uploaded.url,
      filename: file.name || 'รูปภาพจากคลิปบอร์ด',
    };
    renderPendingImage();
    els.replyInput.focus();
  } catch (err) {
    showToast(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`);
  }
}

function renderPendingImage() {
  if (!state.pendingImage) {
    els.pendingImagePreview.classList.add('hidden');
    els.pendingImageThumb.removeAttribute('src');
    return;
  }
  els.pendingImageThumb.src = state.pendingImage.url;
  els.pendingImageName.textContent = state.pendingImage.filename;
  els.pendingImagePreview.classList.remove('hidden');
}

function openLightbox(imageUrl) {
  els.lightboxImg.src = imageUrl;
  els.lightboxDialog.showModal();
}

// -----------------------------------------------------------------------------
// 5. Per-Shop Quick Replies + Hover Preview + `/` Slash Command Picker
// -----------------------------------------------------------------------------
function getQuickRepliesForActiveShop() {
  const activeChannelId = state.activeConversation?.channel_id || null;
  return state.quickReplies.filter((qr) => !qr.channel_id || qr.channel_id === activeChannelId);
}

function showQuickReplyPreview(qr) {
  els.qrPreviewTitle.replaceChildren();
  if (qr.shop_code) {
    const tag = document.createElement('span');
    tag.className = 'qr-shop-tag';
    tag.textContent = qr.shop_code;
    els.qrPreviewTitle.append(tag);
  }
  els.qrPreviewTitle.append(document.createTextNode(`${qr.shortcut} · ${qr.title}`));

  if (qr.media_url) {
    els.qrPreviewImg.src = qr.media_url;
    els.qrPreviewImg.classList.remove('hidden');
  } else {
    els.qrPreviewImg.classList.add('hidden');
    els.qrPreviewImg.removeAttribute('src');
  }

  if (qr.content_text) {
    els.qrPreviewText.textContent = qr.content_text;
    els.qrPreviewText.classList.remove('hidden');
  } else {
    els.qrPreviewText.classList.add('hidden');
  }
  els.qrPreviewPopover.classList.remove('hidden');
}

function hideQuickReplyPreview() {
  els.qrPreviewPopover.classList.add('hidden');
}

function insertQuickReply(qr, { replaceSlash = false } = {}) {
  const current = els.replyInput.value;
  if (qr.content_text) {
    if (replaceSlash || !current.trim()) {
      els.replyInput.value = qr.content_text;
    } else {
      // Preserve existing text the admin already typed and append the quick reply
      const sep = current.endsWith('\n') || current.endsWith(' ') ? '' : '\n';
      els.replyInput.value = `${current}${sep}${qr.content_text}`;
    }
  } else if (replaceSlash) {
    els.replyInput.value = '';
  }

  if (qr.media_url) {
    state.pendingImage = {
      url: qr.media_url,
      filename: `รูปจาก ${qr.shortcut} (${qr.title})`,
    };
    renderPendingImage();
  }

  hideSlashMenu();
  hideQuickReplyPreview();
  els.replyInput.focus();
}

function updateQrModalLivePreview() {
  const text = els.qrContentInput.value.trim();
  if (state.qrModalImage?.url) {
    els.qrModalPreviewImg.src = state.qrModalImage.url;
    els.qrModalPreviewImg.classList.remove('hidden');
    els.qrImageStatus.textContent = state.qrModalImage.filename;
    els.qrRemoveImageBtn.classList.remove('hidden');
  } else {
    els.qrModalPreviewImg.classList.add('hidden');
    els.qrModalPreviewImg.removeAttribute('src');
    els.qrImageStatus.textContent = 'ยังไม่ได้แนบรูป';
    els.qrRemoveImageBtn.classList.add('hidden');
  }

  if (text) {
    els.qrModalPreviewText.textContent = text;
    els.qrModalPreviewText.classList.remove('placeholder', 'hidden');
  } else if (state.qrModalImage?.url) {
    els.qrModalPreviewText.classList.add('hidden');
  } else {
    els.qrModalPreviewText.textContent = 'พิมพ์ข้อความด้านบนเพื่อดูพรีวิว...';
    els.qrModalPreviewText.classList.remove('hidden');
    els.qrModalPreviewText.classList.add('placeholder');
  }
}

async function handleQrModalImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, WEBP, GIF)');
    return;
  }
  try {
    els.qrImageStatus.textContent = 'กำลังอัปโหลด...';
    const dataUrl = await fileToDataUrl(file);
    const uploaded = await api('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    });
    state.qrModalImage = {
      url: uploaded.url,
      filename: file.name || 'รูปภาพจากคลิปบอร์ด',
    };
    updateQrModalLivePreview();
  } catch (err) {
    els.qrImageStatus.textContent = 'อัปโหลดไม่สำเร็จ';
    showToast(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`);
  }
}

function openQuickReplyEditor(qr = null) {
  state.editingQrId = qr ? qr.id : null;
  if (qr) {
    els.qrModalHeading.textContent = `แก้ไขข้อความตอบด่วน (${qr.shortcut})`;
    els.qrSubmitBtn.textContent = 'บันทึกการแก้ไข';
    els.qrChannelSelect.value = qr.channel_id || '';
    els.qrShortcutInput.value = qr.shortcut || '';
    els.qrTitleInput.value = qr.title || '';
    els.qrContentInput.value = qr.content_text || '';
    state.qrModalImage = qr.media_url ? { url: qr.media_url, filename: 'รูปภาพที่แนบไว้' } : null;
  } else {
    els.qrModalHeading.textContent = 'เพิ่มข้อความตอบด่วน (Quick Reply)';
    els.qrSubmitBtn.textContent = 'บันทึกข้อความตอบด่วน';
    els.addQuickReplyForm.reset();
    els.qrChannelSelect.value = state.activeConversation?.channel_id || '';
    state.qrModalImage = null;
  }
  updateQrModalLivePreview();
  els.addQuickReplyDialog.showModal();
}

function renderManageQuickRepliesList() {
  const scope = els.qrManageScopeSelect.value;
  const list = scope === 'active' ? getQuickRepliesForActiveShop() : state.quickReplies;

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '20px';
    empty.style.textAlign = 'center';
    empty.style.color = '#64748b';
    empty.style.fontSize = '13px';
    empty.textContent = 'ยังไม่มีข้อความตอบด่วนในกลุ่มนี้';
    els.qrManageList.replaceChildren(empty);
    return;
  }

  const nodes = list.map((qr) => {
    const row = document.createElement('div');
    row.className = 'qr-manage-item';

    if (qr.media_url) {
      const img = document.createElement('img');
      img.className = 'qr-manage-thumb';
      img.src = qr.media_url;
      img.alt = qr.title;
      row.append(img);
    }

    const info = document.createElement('div');
    info.className = 'qr-manage-info';

    const head = document.createElement('div');
    head.className = 'qr-manage-head';
    const scopeTag = document.createElement('span');
    if (qr.shop_code) {
      scopeTag.className = 'qr-shop-tag';
      scopeTag.textContent = `${qr.platform === 'line' ? 'LINE' : 'FB'} ${qr.shop_code}`;
    } else {
      scopeTag.className = 'qr-global-tag';
      scopeTag.textContent = 'ใช้ทุกร้าน';
    }
    const sc = document.createElement('span');
    sc.className = 'slash-shortcut';
    sc.textContent = qr.shortcut;
    const title = document.createElement('strong');
    title.textContent = qr.title;
    head.append(scopeTag, sc, title);

    const text = document.createElement('div');
    text.className = 'qr-manage-text';
    text.textContent = qr.content_text || '(ส่งเฉพาะรูปภาพ)';

    info.append(head, text);

    const actions = document.createElement('div');
    actions.className = 'qr-manage-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary compact';
    editBtn.textContent = 'แก้ไข';
    editBtn.addEventListener('click', () => openQuickReplyEditor(qr));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger compact';
    deleteBtn.textContent = 'ลบ';
    deleteBtn.addEventListener('click', async () => {
      try {
        await api(`/api/quick-replies/${qr.id}`, { method: 'DELETE' });
        state.quickReplies = state.quickReplies.filter((item) => item.id !== qr.id);
        renderQuickReplies();
        renderManageQuickRepliesList();
        showToast(`ลบข้อความตอบด่วน ${qr.shortcut} เรียบร้อย`);
      } catch (err) {
        showToast(`ลบไม่สำเร็จ: ${err.message}`);
      }
    });

    actions.append(editBtn, deleteBtn);
    row.append(info, actions);
    return row;
  });

  els.qrManageList.replaceChildren(...nodes);
}

function renderQuickReplies() {
  const list = getQuickRepliesForActiveShop();
  els.quickReplyBar.replaceChildren(
    ...list.map((qr) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qr-btn';
      if (qr.shop_code) {
        const tag = document.createElement('span');
        tag.className = 'qr-shop-tag';
        tag.textContent = qr.shop_code;
        btn.append(tag);
      }
      const prefix = qr.media_url ? '🖼 ' : '';
      btn.append(document.createTextNode(`${prefix}${qr.shortcut} ${qr.title}`));
      if (qr.content_text) {
        const snippet = document.createElement('span');
        snippet.className = 'qr-btn-snippet';
        snippet.textContent = `· ${qr.content_text}`;
        btn.append(snippet);
      }
      btn.addEventListener('mouseenter', () => showQuickReplyPreview(qr));
      btn.addEventListener('focus', () => showQuickReplyPreview(qr));
      btn.addEventListener('mouseleave', hideQuickReplyPreview);
      btn.addEventListener('blur', hideQuickReplyPreview);
      btn.addEventListener('click', () => insertQuickReply(qr, { replaceSlash: false }));
      return btn;
    })
  );
}

function updateSlashMenu() {
  const val = els.replyInput.value;
  // Trigger when textarea starts with `/` and has no whitespace yet (or matches `/word`)
  const match = val.match(/^\/([^\s]*)$/);
  if (!match || !state.activeConversationId) {
    hideSlashMenu();
    return;
  }

  const query = match[1].toLowerCase();
  const candidates = getQuickRepliesForActiveShop().filter((qr) => {
    return (
      qr.shortcut.toLowerCase().includes(query) ||
      qr.title.toLowerCase().includes(query) ||
      qr.content_text.toLowerCase().includes(query)
    );
  });

  if (candidates.length === 0) {
    hideSlashMenu();
    return;
  }

  state.slashMatches = candidates;
  state.slashSelectedIndex = Math.min(state.slashSelectedIndex, candidates.length - 1);
  renderSlashMenu();
}

function renderSlashMenu() {
  const nodes = state.slashMatches.map((qr, idx) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `slash-item${idx === state.slashSelectedIndex ? ' active' : ''}`;
    item.setAttribute('role', 'option');

    const top = document.createElement('div');
    top.className = 'slash-item-top';

    if (qr.shop_code) {
      const tag = document.createElement('span');
      tag.className = 'qr-shop-tag';
      tag.textContent = qr.shop_code;
      top.append(tag);
    }

    const sc = document.createElement('span');
    sc.className = 'slash-shortcut';
    sc.textContent = qr.shortcut;

    const title = document.createElement('span');
    title.className = 'slash-title';
    title.textContent = qr.title;

    top.append(sc, title);

    const preview = document.createElement('div');
    preview.className = 'slash-preview';
    preview.textContent = qr.content_text;

    const row = document.createElement('div');
    row.className = 'slash-item-row';

    if (qr.media_url) {
      const thumb = document.createElement('img');
      thumb.className = 'slash-thumb';
      thumb.src = qr.media_url;
      thumb.alt = qr.title;
      row.append(thumb);
    }

    const contentWrap = document.createElement('div');
    contentWrap.className = 'slash-item-content';
    contentWrap.append(top, preview);
    row.append(contentWrap);

    item.append(row);
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      applySlashSelection(idx);
    });
    return item;
  });

  els.slashMenu.replaceChildren(...nodes);
  els.slashMenu.classList.remove('hidden');
}

function applySlashSelection(index = state.slashSelectedIndex) {
  const chosen = state.slashMatches[index];
  if (!chosen) return;
  insertQuickReply(chosen, { replaceSlash: true });
}

function hideSlashMenu() {
  state.slashMatches = [];
  state.slashSelectedIndex = 0;
  els.slashMenu.classList.add('hidden');
}

// -----------------------------------------------------------------------------
// Formatting & Core Renderers
// -----------------------------------------------------------------------------
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday ? timeFormatter.format(d) : dateTimeFormatter.format(d);
}

function updateBadge(el, count) {
  el.textContent = String(count);
  el.classList.toggle('hidden', count <= 0);
}

function renderChannels() {
  const lineChannels = state.channels.filter((c) => c.platform === 'line');
  const fbChannels = state.channels.filter((c) => c.platform === 'facebook');

  const lineUnread = lineChannels.reduce((acc, c) => acc + Number(c.unread_count || 0), 0);
  const fbUnread = fbChannels.reduce((acc, c) => acc + Number(c.unread_count || 0), 0);
  const totalUnread = lineUnread + fbUnread;

  updateBadge(els.totalUnreadBadge, totalUnread);
  updateBadge(els.lineUnreadBadge, lineUnread);
  updateBadge(els.fbUnreadBadge, fbUnread);
  updateTabTitle(totalUnread);

  els.lineNotifyCount.textContent = String(lineUnread);
  els.fbNotifyCount.textContent = String(fbUnread);
  els.lineNotifyBtn.classList.toggle('hidden', lineUnread <= 0);
  els.fbNotifyBtn.classList.toggle('hidden', fbUnread <= 0);
  els.unreadAlertBar.classList.toggle('hidden', lineUnread <= 0 && fbUnread <= 0);

  els.lineChannelList.replaceChildren(...lineChannels.map(createChannelButton));
  els.fbChannelList.replaceChildren(...fbChannels.map(createChannelButton));

  // Populate simulator & quick reply channel selectors
  const channelOptions = state.channels.map((ch) => {
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = `[${ch.platform.toUpperCase()} ${ch.shop_code}] ${ch.name}`;
    return opt;
  });
  els.simChannelSelect.replaceChildren(...channelOptions);

  const globalOpt = document.createElement('option');
  globalOpt.value = '';
  globalOpt.textContent = 'ใช้ได้ทุกร้าน (Global)';
  els.qrChannelSelect.replaceChildren(
    globalOpt,
    ...state.channels.map((ch) => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = `เฉพาะร้าน [${ch.platform.toUpperCase()} ${ch.shop_code}] ${ch.name}`;
      return opt;
    })
  );
}

function createChannelButton(ch) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-item';
  if (state.filter.channelId === ch.id) btn.classList.add('active');

  const label = document.createElement('span');
  const dot = document.createElement('span');
  dot.className = `dot ${ch.platform}`;
  label.append(dot, `${ch.shop_code} · ${ch.name.replace(/^ร้าน |^เพจ /, '')}`);

  const rightIndicator = document.createElement('span');
  rightIndicator.className = 'conv-notify-indicator';
  if (ch.unread_count > 0) {
    const pulseDot = document.createElement('span');
    pulseDot.className = `notify-dot ${ch.platform}`;
    pulseDot.title = ch.platform === 'line' ? 'มีข้อความใหม่จาก LINE' : 'มีข้อความใหม่จาก Facebook';
    const badge = document.createElement('span');
    badge.className = `badge ${ch.platform}`;
    badge.textContent = String(ch.unread_count);
    rightIndicator.append(pulseDot, badge);
  }

  btn.append(label, rightIndicator);
  btn.addEventListener('click', () => {
    state.filter.platform = ch.platform;
    state.filter.channelId = ch.id;
    syncTopNavActive();
    renderChannels();
    loadConversations();
  });
  return btn;
}

function syncTopNavActive() {
  document.querySelectorAll('.nav-item[data-filter-platform]').forEach((btn) => {
    const matchPlatform = btn.dataset.filterPlatform === state.filter.platform;
    const matchChannel = state.filter.channelId === 'all';
    btn.classList.toggle('active', matchPlatform && matchChannel);
  });
}

function filterChannelsForCurrentUser(channels) {
  if (!state.currentUser || state.currentUser.is_manager) return channels;
  const allowed = new Set(state.currentUser.channel_ids || []);
  return channels.filter((c) => allowed.has(c.id));
}

function renderCurrentUserCard() {
  const u = state.currentUser;
  if (!u) return;
  els.userAvatarBadge.textContent = (u.display_name || '?').slice(0, 2);
  els.userAvatarBadge.style.background = u.avatar_color || '#2563eb';
  els.userDisplayName.textContent = u.display_name;
  els.userRoleLabel.textContent = u.is_manager
    ? `${u.role.toUpperCase()} · เห็นทุกร้าน`
    : `${u.role.toUpperCase()} · ${(u.channel_ids || []).length} ร้าน`;

  const isMgr = Boolean(u.is_manager);
  els.openAgentsBtn.classList.toggle('hidden', !isMgr);
  els.openManageChannelsBtn.classList.toggle('hidden', !isMgr);
  els.openAddChannelBtn.classList.toggle('hidden', !isMgr);
  els.toggleNewCampBtn.classList.toggle('hidden', !isMgr);
  els.uploadXlsBtn.classList.toggle('hidden', !isMgr);
  els.importPastedCodesBtn.classList.toggle('hidden', !isMgr);
  els.pasteCodesInput.classList.toggle('hidden', !isMgr);
  els.runManualFallbackBtn.classList.toggle('hidden', !isMgr);
}

function applyEnvironmentMode() {
  const prod = Boolean(state.isProduction);
  if (els.loginDemoBox) els.loginDemoBox.classList.toggle('hidden', prod);
  if (els.openSimulatorBtn) els.openSimulatorBtn.classList.toggle('hidden', prod);
  if (els.chatEmptyHint) els.chatEmptyHint.classList.toggle('hidden', prod);
}

function renderAgents() {
  const unassignedOpt = document.createElement('option');
  unassignedOpt.value = '';
  unassignedOpt.textContent = 'ผู้รับผิดชอบ: ยังไม่ระบุ';
  els.assignAgentSelect.replaceChildren(
    unassignedOpt,
    ...state.agents.map((ag) => {
      const opt = document.createElement('option');
      opt.value = ag.id;
      opt.textContent = `ผู้รับผิดชอบ: ${ag.display_name}`;
      return opt;
    })
  );
}

// -----------------------------------------------------------------------------
// 7. Team & Per-Shop RBAC Management UI (Supervisor / Admin Only)
// -----------------------------------------------------------------------------
function renderAgentShopCheckboxes(selectedIds = []) {
  const sel = new Set(selectedIds);
  const nodes = state.channels.map((ch) => {
    const label = document.createElement('label');
    label.className = 'shop-checkbox-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = ch.id;
    cb.checked = sel.has(ch.id);
    const dot = document.createElement('span');
    dot.className = `dot ${ch.platform}`;
    label.append(cb, dot, `${ch.platform === 'line' ? 'LINE' : 'FB'} ${ch.shop_code}`);
    return label;
  });
  els.agShopCheckboxes.replaceChildren(...nodes);
}

function toggleAgentShopsVisibility() {
  const isMgr = ['owner', 'admin', 'supervisor'].includes(els.agRoleSelect.value);
  els.agShopsSection.classList.toggle('hidden', isMgr);
}

function openAgentEditor(agent = null) {
  state.editingAgentId = agent ? agent.id : null;
  els.agentEditorForm.classList.remove('hidden');
  if (agent) {
    els.agentEditorTitle.textContent = `แก้ไขบัญชี: ${agent.display_name}`;
    els.agNameInput.value = agent.display_name;
    els.agEmailInput.value = agent.email;
    els.agEmailInput.disabled = true;
    els.agPasswordInput.value = '';
    els.agPasswordInput.required = false;
    els.agPwHint.textContent = 'ปล่อยว่างถ้าไม่เปลี่ยน';
    els.agRoleSelect.value = agent.role;
    renderAgentShopCheckboxes(agent.channel_ids || []);
  } else {
    els.agentEditorTitle.textContent = 'เพิ่มบัญชีแอดมินใหม่';
    els.agentEditorForm.reset();
    els.agEmailInput.disabled = false;
    els.agPasswordInput.required = true;
    els.agPwHint.textContent = 'อย่างน้อย 6 ตัว';
    els.agRoleSelect.value = 'agent';
    renderAgentShopCheckboxes([]);
  }
  toggleAgentShopsVisibility();
}

async function loadAgentsManagementList() {
  const data = await api('/api/agents');
  state.agents = data.agents || [];
  renderAgents();

  const chMap = new Map(state.channels.map((c) => [c.id, c]));
  const nodes = state.agents.map((ag) => {
    const row = document.createElement('div');
    row.className = 'qr-manage-item';

    const av = document.createElement('div');
    av.className = 'user-mini-avatar';
    av.style.background = ag.avatar_color || '#2563eb';
    av.textContent = (ag.display_name || '?').slice(0, 2);

    const info = document.createElement('div');
    info.className = 'qr-manage-info';

    const head = document.createElement('div');
    head.className = 'qr-manage-head';
    const nameEl = document.createElement('strong');
    nameEl.textContent = ag.display_name;
    const roleTag = document.createElement('span');
    roleTag.className = ag.is_manager ? 'qr-shop-tag' : 'qr-global-tag';
    roleTag.textContent = ag.role.toUpperCase();
    const statusTag = document.createElement('span');
    statusTag.className = `vch-status ${ag.is_active ? 'available' : 'claimed'}`;
    statusTag.textContent = ag.is_active ? 'เปิดใช้งาน' : 'ระงับแล้ว';
    head.append(nameEl, roleTag, statusTag);

    const sub = document.createElement('div');
    sub.className = 'qr-manage-text';
    sub.textContent = `${ag.email}${ag.last_login_at ? ` · เข้าระบบล่าสุด ${formatTime(ag.last_login_at)}` : ''}`;

    const perms = document.createElement('div');
    perms.className = 'agent-perm-pills';
    if (ag.is_manager) {
      const p = document.createElement('span');
      p.className = 'qr-shop-tag';
      p.textContent = 'เข้าถึงทุกร้านค้า (Full Access)';
      perms.append(p);
    } else if ((ag.channel_ids || []).length === 0) {
      const p = document.createElement('span');
      p.className = 'qr-global-tag';
      p.textContent = 'ยังไม่กำหนดสิทธิ์ร้านค้า';
      perms.append(p);
    } else {
      for (const cid of ag.channel_ids) {
        const ch = chMap.get(cid);
        if (!ch) continue;
        const p = document.createElement('span');
        p.className = `channel-pill ${ch.platform}`;
        p.textContent = `${ch.platform === 'line' ? 'LINE' : 'FB'} ${ch.shop_code}`;
        perms.append(p);
      }
    }

    info.append(head, sub, perms);

    const actions = document.createElement('div');
    actions.className = 'qr-manage-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary compact';
    editBtn.textContent = 'แก้ไขสิทธิ์';
    editBtn.addEventListener('click', () => openAgentEditor(ag));
    actions.append(editBtn);

    if (ag.id !== state.currentUser?.id) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = ag.is_active ? 'btn btn-danger compact' : 'btn btn-voucher compact';
      toggleBtn.textContent = ag.is_active ? 'ระงับ' : 'เปิดใช้';
      toggleBtn.addEventListener('click', async () => {
        try {
          await api(`/api/agents/${ag.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive: !ag.is_active }),
          });
          await loadAgentsManagementList();
          showToast(ag.is_active ? `ระงับบัญชี ${ag.display_name} แล้ว` : `เปิดใช้งาน ${ag.display_name} แล้ว`);
        } catch (err) {
          showToast(err.message);
        }
      });
      actions.append(toggleBtn);
    }

    row.append(av, info, actions);
    return row;
  });

  els.agentsListContainer.replaceChildren(...nodes);
}

// -----------------------------------------------------------------------------
// 8. Manage Channels & Copy Full Webhook URL (Supervisor / Admin)
// -----------------------------------------------------------------------------
function getFullWebhookUrl(webhookPath) {
  const base = state.publicBaseUrl || window.location.origin;
  return `${base.replace(/\/+$/, '')}${webhookPath}`;
}

function openChannelEditor(ch) {
  state.editingChannelId = ch.id;
  els.editChannelHeading.textContent = `แก้ไขตั้งค่า: [${ch.platform.toUpperCase()} ${ch.shop_code}] ${ch.name}`;
  els.editChName.value = ch.name;
  els.editChExternalId.value = ch.external_channel_id;
  els.editChAccessToken.value = '';
  els.editChSecret.value = '';
  els.editChSecretWrap.classList.toggle('hidden', ch.platform !== 'line');
  els.editChannelForm.classList.remove('hidden');
}

function renderManageChannelsList() {
  const envBadge = state.isProduction ? '🚀 PRODUCTION' : '🧪 DEV';
  const dbLabel = state.dbEngine === 'postgres' ? '🐘 PostgreSQL' : '💾 SQLite';
  const storageLabel = state.storageProvider === 'cloudflare-r2' ? '☁️ Cloudflare R2' : '📁 Local Disk';
  const baseLabel = state.publicBaseUrl
    ? `URL: ${state.publicBaseUrl}`
    : 'ยังไม่ได้ตั้ง PUBLIC_BASE_URL';
  const modeLabel = state.liveDeliveryEnabled ? '🟢 LIVE_DELIVERY=ON' : '⚪ Mock Delivery';
  const aiLabel = state.geminiEnabled ? '🟢 Gemini AI Live' : '⚪ Mock AI';
  els.liveEnvBanner.textContent = `${envBadge} · ${dbLabel} · ${storageLabel} · ${modeLabel} · ${aiLabel} · ${baseLabel}`;

  const nodes = state.channels.map((ch) => {
    const row = document.createElement('div');
    row.className = 'qr-manage-item';

    const info = document.createElement('div');
    info.className = 'qr-manage-info';

    const head = document.createElement('div');
    head.className = 'qr-manage-head';

    const pill = document.createElement('span');
    pill.className = `channel-pill ${ch.platform}`;
    pill.textContent = `${ch.platform === 'line' ? 'LINE' : 'FB'} ${ch.shop_code}`;

    const title = document.createElement('strong');
    title.textContent = ch.name;

    const tokBadge = document.createElement('span');
    tokBadge.className = `vch-status ${ch.has_real_token ? 'available' : 'claimed'}`;
    tokBadge.textContent = ch.has_real_token ? '🟢 Token จริง' : '⚪ Mock Token';

    head.append(pill, title, tokBadge);

    const fullUrl = getFullWebhookUrl(ch.webhook_url);
    const urlLine = document.createElement('div');
    urlLine.className = 'qr-manage-text mono';
    urlLine.textContent = `ID: ${ch.external_channel_id} · Webhook: ${fullUrl}`;

    info.append(head, urlLine);

    const actions = document.createElement('div');
    actions.className = 'qr-manage-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-secondary compact';
    copyBtn.textContent = '📋 คัดลอก URL';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(fullUrl);
        showToast(`คัดลอก Webhook URL แล้ว: ${fullUrl}`);
      } catch {
        showToast(fullUrl);
      }
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-primary compact';
    editBtn.textContent = 'แก้ Token';
    editBtn.addEventListener('click', () => openChannelEditor(ch));

    actions.append(copyBtn, editBtn);
    row.append(info, actions);
    return row;
  });

  els.manageChannelsList.replaceChildren(...nodes);
}

function renderConversations() {
  if (state.conversations.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '24px';
    empty.style.textAlign = 'center';
    empty.style.color = '#64748b';
    empty.style.fontSize = '13px';
    empty.textContent = 'ไม่พบห้องแชทตามตัวกรองที่เลือก';
    els.conversationList.replaceChildren(empty);
    return;
  }

  const nodes = state.conversations.map((conv) => {
    const isUnread = Number(conv.unread_count || 0) > 0;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = [
      'conv-card',
      conv.id === state.activeConversationId ? 'active' : '',
      isUnread ? `unread ${conv.platform}` : '',
    ].filter(Boolean).join(' ');

    const top = document.createElement('div');
    top.className = 'conv-top';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'conv-name-wrap';
    if (isUnread) {
      const alertDot = document.createElement('span');
      alertDot.className = `notify-dot ${conv.platform}`;
      alertDot.title = conv.platform === 'line' ? 'ข้อความใหม่จาก LINE' : 'ข้อความใหม่จาก Facebook';
      alertDot.setAttribute('aria-label', alertDot.title);
      nameWrap.append(alertDot);
    }

    const name = document.createElement('span');
    name.className = 'conv-name';
    name.textContent = conv.customer_name;
    nameWrap.append(name);

    const time = document.createElement('span');
    time.className = 'conv-time';
    time.textContent = formatTime(conv.last_message_at);
    top.append(nameWrap, time);

    const preview = document.createElement('div');
    preview.className = 'conv-preview';
    preview.textContent = conv.last_message_preview || '(ไม่มีข้อความ)';

    const bottom = document.createElement('div');
    bottom.className = 'conv-bottom';

    const leftMeta = document.createElement('div');
    leftMeta.style.display = 'flex';
    leftMeta.style.alignItems = 'center';
    leftMeta.style.gap = '5px';
    leftMeta.style.flexWrap = 'wrap';

    const pill = document.createElement('span');
    pill.className = `channel-pill ${conv.platform}`;
    pill.textContent = `${conv.platform === 'line' ? 'LINE' : 'FB'} ${conv.shop_code}`;
    leftMeta.append(pill);

    if (conv.status === 'pending') {
      const pendingChip = document.createElement('span');
      pendingChip.className = 'pending-chip';
      pendingChip.textContent = '🚩 ต้องดำเนินการ';
      leftMeta.append(pendingChip);
    }

    // SLA wait timer on unreplied conversations
    const sla = getSlaInfo(conv);
    if (sla) {
      const slaPill = document.createElement('span');
      slaPill.className = `sla-pill ${sla.level}`;
      slaPill.textContent = sla.label;
      leftMeta.append(slaPill);
    }

    // Live collision viewer pill if another admin is viewing
    const viewers = getOtherViewers(conv.id);
    if (viewers.length > 0) {
      const vp = document.createElement('span');
      vp.className = 'viewer-pill';
      vp.textContent = `👁 ${viewers[0].agentName}`;
      leftMeta.append(vp);
    } else if (conv.assigned_agent_name) {
      const agChip = document.createElement('span');
      agChip.className = 'agent-chip';
      agChip.textContent = conv.assigned_agent_name;
      leftMeta.append(agChip);
    }

    bottom.append(leftMeta);

    if (isUnread) {
      const badge = document.createElement('span');
      badge.className = `badge ${conv.platform}`;
      badge.textContent = String(conv.unread_count);
      bottom.append(badge);
    } else if (conv.is_replied && conv.status === 'open') {
      const repliedChip = document.createElement('span');
      repliedChip.className = 'replied-chip';
      repliedChip.textContent = '✓ ตอบแล้ว';
      bottom.append(repliedChip);
    }

    card.append(top, preview, bottom);
    card.addEventListener('click', () => selectConversation(conv.id));
    return card;
  });

  els.conversationList.replaceChildren(...nodes);
}

function renderActiveChat(conv) {
  state.activeConversation = conv || null;

  if (!conv) {
    els.chatEmptyState.classList.remove('hidden');
    els.chatWorkspace.classList.add('hidden');
    els.infoPanel.classList.add('hidden');
    els.collisionBanner.classList.add('hidden');
    hideSlashMenu();
    return;
  }

  els.chatEmptyState.classList.add('hidden');
  els.chatWorkspace.classList.remove('hidden');
  els.infoPanel.classList.remove('hidden');

  els.chatCustomerAvatar.textContent = (conv.customer_name || '?').slice(0, 2);
  els.chatCustomerName.textContent = conv.customer_name;
  els.chatChannelPill.className = `channel-pill ${conv.platform}`;
  els.chatChannelPill.textContent = `${conv.platform === 'line' ? 'LINE' : 'FB'} ${conv.shop_code} · ${conv.channel_name}`;

  const policy = conv.policy;
  els.chatPolicyBanner.textContent = policy ? policy.label : '';
  els.chatPolicyBanner.className = 'policy-text';
  if (policy?.mode === 'line_reply' || policy?.mode === 'fb_standard') {
    els.chatPolicyBanner.classList.add('free');
  } else if (policy?.mode === 'line_push' || policy?.mode === 'fb_human_agent' || policy?.mode === 'fb_expired') {
    els.chatPolicyBanner.classList.add('warn');
  }

  els.assignAgentSelect.value = conv.assigned_agent_id || '';
  els.convStatusSelect.value = conv.status;

  const isPending = conv.status === 'pending';
  els.escalateBtn.classList.toggle('active', isPending);
  els.escalateBtn.textContent = isPending ? '🚩 อยู่ในต้องดำเนินการ (นำออก)' : '🚩 ต้องดำเนินการ';
  els.escalateBtn.title = isPending
    ? 'คลิกเพื่อนำแชทนี้ออกจากโฟลเดอร์ "ต้องดำเนินการ" กลับไปสถานะเปิดอยู่'
    : 'คลิกเพื่อย้ายแชทนี้ไปโฟลเดอร์ "ต้องดำเนินการ"';

  renderCollisionBanner();
  renderQuickReplies();

  // Render messages (images render directly without a colored chat bubble behind them)
  const msgNodes = state.activeMessages.map((m) => {
    const row = document.createElement('div');
    row.className = `msg-row ${m.sender_type === 'customer' ? 'customer' : 'agent'}`;

    if (m.media_url) {
      const img = document.createElement('img');
      img.className = 'msg-image';
      img.src = m.media_url;
      img.alt = m.content_text || 'รูปภาพในแชท';
      img.loading = 'lazy';
      img.addEventListener('click', () => openLightbox(m.media_url));
      row.append(img);
    }

    if (m.content_text) {
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.textContent = m.content_text;
      row.append(bubble);
    }

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const who = m.sender_type === 'customer' ? conv.customer_name : (m.sender_agent_name || 'แอดมิน');
    meta.append(document.createTextNode(`${who} · ${formatTime(m.created_at)}`));
    if (m.delivery_method) {
      const tag = document.createElement('span');
      tag.className = 'method-tag';
      tag.textContent = m.delivery_method;
      meta.append(tag);
    }

    row.append(meta);
    return row;
  });

  const wasNearBottom =
    els.messageList.scrollHeight - els.messageList.scrollTop - els.messageList.clientHeight < 80;
  els.messageList.replaceChildren(...msgNodes);
  if (wasNearBottom || state.forceScrollBottom) {
    els.messageList.scrollTop = els.messageList.scrollHeight;
    els.jumpNewMsgBtn.classList.add('hidden');
    state.forceScrollBottom = false;
  }

  // Info panel
  const channel = state.channels.find((c) => c.id === conv.channel_id);
  els.infoCustomerName.textContent = conv.customer_name;
  els.infoExternalUserId.textContent = conv.customer_external_id;
  els.infoChannelName.textContent = `${conv.channel_name} (${conv.platform.toUpperCase()} ${conv.shop_code})`;
  els.infoWebhookUrl.textContent = channel ? channel.webhook_url : '-';
  els.customerNotesInput.value = conv.customer_notes || '';

  renderTags(conv);
  syncEvidenceUrlsFromMessages();
  renderEvidencePicker();
  renderAiVerdict();
}

// -----------------------------------------------------------------------------
// 6. Campaigns, Gift Vouchers (.xls) & AI Evidence Verification
// -----------------------------------------------------------------------------
function renderCampaignSelectors() {
  const prevVerifyVal = els.verifyCampaignSelect.value;
  const prevManageVal = els.campManageSelect.value;

  const makeOpts = () =>
    state.campaigns.map((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (เหลือ ${c.available_vouchers}/${c.total_vouchers})`;
      return opt;
    });

  els.verifyCampaignSelect.replaceChildren(...makeOpts());
  els.campManageSelect.replaceChildren(...makeOpts());

  if (prevVerifyVal && state.campaigns.some((c) => c.id === prevVerifyVal)) {
    els.verifyCampaignSelect.value = prevVerifyVal;
  }
  if (prevManageVal && state.campaigns.some((c) => c.id === prevManageVal)) {
    els.campManageSelect.value = prevManageVal;
  }

  els.aiProviderBadge.textContent = state.geminiEnabled ? 'Gemini AI Live' : 'Mock AI Mode';
  els.aiProviderBadge.classList.toggle('live', state.geminiEnabled);
  els.mockAiScenarioSelect.classList.toggle('hidden', state.geminiEnabled);
}

function getCustomerEvidenceImages() {
  return state.activeMessages
    .filter((m) => m.sender_type === 'customer' && m.media_url)
    .map((m) => m.media_url);
}

function syncEvidenceUrlsFromMessages() {
  const customerImgs = getCustomerEvidenceImages();
  // Keep previously selected URLs that still exist; auto-select any newly arrived customer images
  const next = new Set();
  for (const url of customerImgs) {
    next.add(url);
  }
  state.selectedEvidenceUrls = next;
}

function renderEvidencePicker() {
  const urls = getCustomerEvidenceImages();
  els.evidenceSelectedCount.textContent = `${state.selectedEvidenceUrls.size} / ${urls.length} รูป`;
  els.runAiVerifyBtn.disabled = state.selectedEvidenceUrls.size === 0 || state.campaigns.length === 0;
  if (els.runManualFallbackBtn) {
    els.runManualFallbackBtn.disabled = state.selectedEvidenceUrls.size === 0 || state.campaigns.length === 0;
  }

  if (urls.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'evidence-empty';
    empty.textContent = state.isProduction
      ? 'ยังไม่มีรูปภาพที่ลูกค้าส่งมาในห้องนี้'
      : 'ยังไม่มีรูปภาพที่ลูกค้าส่งมาในห้องนี้ (ลองส่งรูปจำลองผ่าน Simulator)';
    els.evidenceThumbGrid.replaceChildren(empty);
    return;
  }

  const nodes = urls.map((url) => {
    const isSel = state.selectedEvidenceUrls.has(url);
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = `evidence-thumb-item${isSel ? ' selected' : ''}`;
    wrap.title = isSel ? 'คลิกเพื่อเอาออกจากการตรวจ' : 'คลิกเพื่อรวมรูปนี้เข้าชุดตรวจ';

    const img = document.createElement('img');
    img.src = url;
    img.alt = 'รูปหลักฐานลูกค้า';
    wrap.append(img);

    if (isSel) {
      const check = document.createElement('span');
      check.className = 'evidence-thumb-check';
      check.textContent = '✓';
      wrap.append(check);
    }

    wrap.addEventListener('click', () => {
      if (state.selectedEvidenceUrls.has(url)) {
        state.selectedEvidenceUrls.delete(url);
      } else {
        state.selectedEvidenceUrls.add(url);
      }
      renderEvidencePicker();
    });
    return wrap;
  });

  els.evidenceThumbGrid.replaceChildren(...nodes);
}

async function loadConversationSubmissions(conversationId) {
  const data = await api(`/api/conversations/${conversationId}/submissions`);
  state.activeSubmissions = data.submissions || [];
  renderAiVerdict();
}

function renderAiVerdict() {
  const selectedCampId = els.verifyCampaignSelect.value;
  const latest =
    state.activeSubmissions.find((s) => !selectedCampId || s.campaign_id === selectedCampId) ||
    state.activeSubmissions[0] ||
    null;

  if (!latest) {
    els.aiVerdictContainer.classList.add('hidden');
    els.aiVerdictContainer.replaceChildren();
    return;
  }

  els.aiVerdictContainer.className = `ai-verdict-container ${latest.ai_verdict}`;
  els.aiVerdictContainer.replaceChildren();

  const header = document.createElement('div');
  header.className = 'verdict-header';
  const title = document.createElement('strong');
  title.style.fontSize = '12px';
  title.textContent =
    latest.ai_verdict === 'pass'
      ? '🟢 ผ่านเกณฑ์ (ไม่พบ Fraud)'
      : latest.ai_verdict === 'fraud'
        ? '🔴 พบความเสี่ยง Fraud / ซ้ำ'
        : '🟡 ยังไม่ถึงเกณฑ์ 90%';

  const score = document.createElement('span');
  score.className = `verdict-score ${latest.ai_verdict}`;
  score.textContent = `${latest.ai_confidence}%`;
  header.append(title, score);

  const summary = document.createElement('div');
  summary.className = 'verdict-summary';
  summary.textContent = latest.ai_summary;

  const list = document.createElement('ul');
  list.className = 'verdict-checklist';
  for (const item of latest.ai_checklist || []) {
    const li = document.createElement('li');
    li.textContent = `${item.passed ? '✅' : '❌'} ${item.label}: ${item.detail}`;
    list.append(li);
  }

  els.aiVerdictContainer.append(header, summary, list);

  if (latest.extracted_fb_name) {
    const fbMeta = document.createElement('div');
    fbMeta.style.fontSize = '11px';
    fbMeta.style.color = '#475569';
    fbMeta.textContent = `👤 บัญชี FB ในหลักฐาน: ${latest.extracted_fb_name}`;
    els.aiVerdictContainer.append(fbMeta);
  }

  if (latest.status === 'approved' && latest.voucher_code) {
    const issued = document.createElement('div');
    issued.className = 'issued-code-box';
    issued.innerHTML = `<span style="font-size:11px;color:#047857;">✅ มอบโค้ด Gift Voucher แล้ว (1 code/1 time)</span>`;
    const codeStrong = document.createElement('strong');
    codeStrong.textContent = latest.voucher_code;
    issued.append(codeStrong);
    els.aiVerdictContainer.append(issued);
    return;
  }

  if (latest.status === 'rejected') {
    const rej = document.createElement('div');
    rej.style.fontSize = '11.5px';
    rej.style.color = '#b91c1c';
    rej.style.fontWeight = '600';
    rej.textContent = 'รายการนี้ถูกปฏิเสธแล้ว (กดตรวจใหม่เมื่อลูกค้าส่งรูปเพิ่ม)';
    els.aiVerdictContainer.append(rej);
    return;
  }

  // Action buttons for Admin (Human-in-the-loop Gate: >= 90% & no fraud unlocks Approve)
  const actions = document.createElement('div');
  actions.className = 'verdict-actions';

  const canApprove =
    latest.ai_verdict === 'pass' &&
    latest.ai_confidence >= (latest.min_confidence || 90) &&
    (!latest.fraud_flags || latest.fraud_flags.length === 0);

  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.className = 'btn btn-approve full-width compact';
  approveBtn.disabled = !canApprove;
  approveBtn.textContent = canApprove
    ? '🎁 อนุมัติ & ส่งโค้ด Gift Voucher'
    : '🔒 ล็อกการแจกโค้ด (ต้อง ≥ 90% & ไม่ Fraud)';
  approveBtn.addEventListener('click', async () => {
    try {
      approveBtn.disabled = true;
      const res = await api(`/api/submissions/${latest.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ agentId: state.currentAgentId }),
      });
      showToast(`🎁 แจกโค้ด ${res.voucher.code} สำเร็จ (1 code / 1 time)`);
      await loadConversationSubmissions(state.activeConversationId);
      await loadConversations();
    } catch (err) {
      approveBtn.disabled = false;
      showToast(`แจกโค้ดไม่สำเร็จ: ${err.message}`);
    }
  });
  actions.append(approveBtn);

  if (!canApprove) {
    const noFraud = !latest.fraud_flags || latest.fraud_flags.length === 0;
    if (state.currentUser?.is_manager && noFraud) {
      const overrideBtn = document.createElement('button');
      overrideBtn.type = 'button';
      overrideBtn.className = 'btn btn-voucher full-width compact';
      overrideBtn.textContent = '🛡 Supervisor อนุมัติแจกโค้ด (Manual Override)';
      overrideBtn.addEventListener('click', async () => {
        try {
          overrideBtn.disabled = true;
          const res = await api(`/api/submissions/${latest.id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ agentId: state.currentAgentId, allowOverride: true }),
          });
          showToast(`🎁 Supervisor อนุมัติแจกโค้ด ${res.voucher.code} สำเร็จ (1 code / 1 time)`);
          await loadConversationSubmissions(state.activeConversationId);
          await loadConversations();
        } catch (err) {
          overrideBtn.disabled = false;
          showToast(`อนุมัติไม่สำเร็จ: ${err.message}`);
        }
      });
      actions.append(overrideBtn);
    }

    const askMoreBtn = document.createElement('button');
    askMoreBtn.type = 'button';
    askMoreBtn.className = 'btn btn-secondary full-width compact';
    askMoreBtn.textContent = '📩 ส่งข้อความขอหลักฐานเพิ่ม';
    askMoreBtn.addEventListener('click', async () => {
      await api(`/api/submissions/${latest.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          agentId: state.currentAgentId,
          notifyText: 'รบกวนส่งภาพหลักฐานการกดไลก์เพจ และภาพแชร์โพสต์แบบเปิดสาธารณะ (เห็นไอคอนลูกโลก 🌐) เพิ่มเติมให้ครบถ้วนนะครับ',
        }),
      });
      showToast('ส่งข้อความขอหลักฐานเพิ่มเรียบร้อย');
      await loadConversationSubmissions(state.activeConversationId);
    });

    const escBtn = document.createElement('button');
    escBtn.type = 'button';
    escBtn.className = 'btn btn-escalate full-width compact';
    escBtn.textContent = '🚩 ส่งไปโฟลเดอร์ "ต้องดำเนินการ"';
    escBtn.addEventListener('click', async () => {
      await api(`/api/submissions/${latest.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ agentId: state.currentAgentId, escalate: true }),
      });
      showToast('ย้ายเคสไปโฟลเดอร์ "🚩 ต้องดำเนินการ" แล้ว');
      await loadConversationSubmissions(state.activeConversationId);
    });

    actions.append(askMoreBtn, escBtn);
  }

  els.aiVerdictContainer.append(actions);
}

async function loadCampaignVouchers(campaignId) {
  if (!campaignId) return;
  const data = await api(`/api/campaigns/${campaignId}/vouchers`);
  const camp = data.campaign;
  els.statAvailable.textContent = String(camp?.available_vouchers ?? 0);
  els.statClaimed.textContent = String(camp?.claimed_vouchers ?? 0);
  els.statTotal.textContent = String(camp?.total_vouchers ?? 0);
  els.exportXlsLink.href = `/api/campaigns/${campaignId}/vouchers/export.xls`;

  const rows = (data.vouchers || []).map((v) => {
    const tr = document.createElement('tr');
    const tdCode = document.createElement('td');
    tdCode.className = 'mono';
    tdCode.textContent = v.code;

    const tdVal = document.createElement('td');
    tdVal.textContent = v.reward_value || '-';

    const tdStatus = document.createElement('td');
    const st = document.createElement('span');
    st.className = `vch-status ${v.status}`;
    st.textContent = v.status === 'claimed' ? 'แจกแล้ว (1/1)' : 'พร้อมแจก';
    tdStatus.append(st);

    const tdCust = document.createElement('td');
    tdCust.textContent = v.customer_name
      ? `${v.customer_name} (${v.platform?.toUpperCase() || ''} ${v.shop_code || ''})`
      : '-';

    const tdScore = document.createElement('td');
    tdScore.textContent = v.ai_confidence != null ? `${v.ai_confidence}%` : '-';

    const tdTime = document.createElement('td');
    tdTime.textContent = v.claimed_at ? `${v.agent_name || ''} · ${formatTime(v.claimed_at)}` : '-';

    tr.append(tdCode, tdVal, tdStatus, tdCust, tdScore, tdTime);
    return tr;
  });

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.style.textAlign = 'center';
    td.style.color = '#64748b';
    td.textContent = 'ยังไม่มีโค้ดในกิจกรรมนี้ กรุณานำเข้าไฟล์ .xls';
    tr.append(td);
    els.voucherTableBody.replaceChildren(tr);
    return;
  }

  els.voucherTableBody.replaceChildren(...rows);
}

function renderSimImagePreviews() {
  els.simClearImagesBtn.classList.toggle('hidden', state.simImageUrls.length === 0);
  els.simImagePreviewList.replaceChildren(
    ...state.simImageUrls.map((url) => {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'รูปหลักฐานจำลอง';
      return img;
    })
  );
}

async function generateAndUploadMockProof(title, subtitle, bg) {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 480, 320);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(24, 24, 432, 272);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(title, 44, 100);
  ctx.fillStyle = '#2563eb';
  ctx.font = '20px sans-serif';
  ctx.fillText(subtitle, 44, 150);
  ctx.fillStyle = '#64748b';
  ctx.font = '15px monospace';
  ctx.fillText(`Proof ID: ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, 44, 240);
  const dataUrl = canvas.toDataURL('image/png');
  const uploaded = await api('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ dataUrl }),
  });
  return uploaded.url;
}

function renderTags(conv) {
  const tags = Array.isArray(conv.customer_tags) ? conv.customer_tags : [];
  els.infoTagsContainer.replaceChildren(
    ...tags.map((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = tag;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.ariaLabel = `ลบแท็ก ${tag}`;
      removeBtn.addEventListener('click', async () => {
        const nextTags = tags.filter((t) => t !== tag);
        await updateActiveConvMeta({ tags: nextTags });
      });
      chip.append(removeBtn);
      return chip;
    })
  );
}

async function loadConversations() {
  const params = new URLSearchParams();
  if (state.filter.platform !== 'all') params.set('platform', state.filter.platform);
  if (state.filter.channelId !== 'all') params.set('channelId', state.filter.channelId);
  if (state.filter.box && state.filter.box !== 'all') params.set('box', state.filter.box);
  if (state.filter.q.trim()) params.set('q', state.filter.q.trim());

  const data = await api(`/api/conversations?${params.toString()}`);
  state.conversations = data.conversations;
  if (data.counts) {
    state.counts = data.counts;
    els.tabCountUnreplied.textContent = String(data.counts.unreplied ?? 0);
    els.tabCountPending.textContent = String(data.counts.pending ?? 0);
    els.tabCountReplied.textContent = String(data.counts.replied ?? 0);
    els.tabCountResolved.textContent = String(data.counts.resolved ?? 0);
    els.tabCountAll.textContent = String(data.counts.all ?? 0);
    els.pendingFolderTab.classList.toggle('has-pending', Number(data.counts.pending || 0) > 0);
  }
  renderConversations();
}

function closeActiveConversation() {
  if (!state.activeConversationId) return;
  state.activeConversationId = null;
  state.activeConversation = null;
  state.activeMessages = [];
  state.pendingImage = null;
  renderPendingImage();
  els.jumpNewMsgBtn.classList.add('hidden');
  renderActiveChat(null);
  renderConversations();
  reportPresence({ conversationId: null, isTyping: false });
}

async function selectConversation(conversationId) {
  state.activeConversationId = conversationId;
  state.forceScrollBottom = true;
  state.pendingImage = null;
  renderPendingImage();
  hideSlashMenu();
  els.jumpNewMsgBtn.classList.add('hidden');
  renderConversations();

  const data = await api(`/api/conversations/${conversationId}/messages`);
  state.activeMessages = data.messages;
  state.activeSubmissions = [];
  renderActiveChat(data.conversation);
  loadConversationSubmissions(conversationId).catch(() => {});
  reportPresence({ conversationId, isTyping: false });

  if (data.conversation.unread_count > 0) {
    await api(`/api/conversations/${conversationId}/read`, { method: 'POST' });
  }
}

async function updateActiveConvMeta(patch) {
  if (!state.activeConversationId) return;
  const data = await api(`/api/conversations/${state.activeConversationId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  renderActiveChat(data.conversation);
  await loadConversations();
}

// -----------------------------------------------------------------------------
// SSE Real-time Stream
// -----------------------------------------------------------------------------
function disconnectSse() {
  if (state.sseSource) {
    state.sseSource.close();
    state.sseSource = null;
  }
}

function connectSse() {
  disconnectSse();
  const es = new EventSource(`/api/events?clientId=${encodeURIComponent(state.clientId)}`);
  state.sseSource = es;

  es.addEventListener('connected', () => {
    els.sseStatus.textContent = '● Live Real-time';
    els.sseStatus.className = 'sse-pill online';
    if (state.activeConversationId) {
      reportPresence({ conversationId: state.activeConversationId, isTyping: false });
    }
  });

  es.addEventListener('message:created', async (event) => {
    const payload = JSON.parse(event.data);
    if (payload.channels) {
      state.channels = filterChannelsForCurrentUser(payload.channels);
      renderChannels();
    }
    const convChannelId = payload.conversation?.channel_id;
    const canSeeThisConv =
      !state.currentUser ||
      state.currentUser.is_manager ||
      (state.currentUser.channel_ids || []).includes(convChannelId);

    if (!canSeeThisConv) return;
    await loadConversations();

    const isCustomerMsg = payload.message?.sender_type === 'customer';
    if (isCustomerMsg) {
      playNotificationSound(payload.conversation?.platform || 'line');
    }

    if (payload.conversation?.id === state.activeConversationId) {
      const isScrolledUp =
        els.messageList.scrollHeight - els.messageList.scrollTop - els.messageList.clientHeight >= 80;
      const data = await api(`/api/conversations/${state.activeConversationId}/messages`);
      state.activeMessages = data.messages;
      renderActiveChat(data.conversation);
      if (isCustomerMsg) {
        if (isScrolledUp) {
          const p = payload.conversation.platform;
          els.jumpNewMsgBtn.className = `jump-new-btn ${p}`;
          els.jumpNewMsgDot.className = `notify-dot ${p}`;
          els.jumpNewMsgText.textContent = p === 'line'
            ? `ข้อความใหม่จาก LINE ${payload.conversation.shop_code} ↓`
            : `ข้อความใหม่จาก Facebook ${payload.conversation.shop_code} ↓`;
        }
        await api(`/api/conversations/${state.activeConversationId}/read`, { method: 'POST' });
      }
    } else if (isCustomerMsg) {
      const conv = payload.conversation;
      showToast(
        `ข้อความใหม่ [${conv.platform === 'line' ? 'LINE' : 'FB'} ${conv.shop_code}] ${conv.customer_name}`,
        {
          platform: conv.platform,
          onClick: () => selectConversation(conv.id),
        }
      );
    }
  });

  es.addEventListener('conversation:updated', async (event) => {
    const payload = JSON.parse(event.data);
    if (payload.channels) {
      state.channels = filterChannelsForCurrentUser(payload.channels);
      renderChannels();
    }
    await loadConversations();
    if (payload.conversation?.id === state.activeConversationId) {
      renderActiveChat(payload.conversation);
    }
  });

  es.addEventListener('channels:updated', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.channels) {
      state.channels = filterChannelsForCurrentUser(payload.channels);
      renderChannels();
      if (els.manageChannelsDialog.open) {
        renderManageChannelsList();
      }
    }
  });

  es.addEventListener('presence:updated', (event) => {
    const payload = JSON.parse(event.data);
    state.presence = payload.presence || {};
    renderCollisionBanner();
    renderConversations();
  });

  es.addEventListener('quickReplies:updated', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.quickReplies) {
      state.quickReplies = payload.quickReplies;
      renderQuickReplies();
      if (els.manageQuickRepliesDialog.open) {
        renderManageQuickRepliesList();
      }
    }
  });

  es.addEventListener('campaigns:updated', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.campaigns) {
      state.campaigns = payload.campaigns;
      renderCampaignSelectors();
      if (els.campaignsDialog.open && els.campManageSelect.value) {
        loadCampaignVouchers(els.campManageSelect.value).catch(() => {});
      }
    }
  });

  es.addEventListener('submission:updated', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.conversationId === state.activeConversationId) {
      loadConversationSubmissions(state.activeConversationId).catch(() => {});
    }
  });

  es.onerror = () => {
    els.sseStatus.textContent = '○ Reconnecting...';
    els.sseStatus.className = 'sse-pill offline';
  };
}

// -----------------------------------------------------------------------------
// Event Bindings
// -----------------------------------------------------------------------------
function bindEvents() {
  // Sound toggle
  els.soundToggleBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem('omnichat_sound', state.soundEnabled ? 'on' : 'off');
    updateSoundButtonUI();
    if (state.soundEnabled) {
      playNotificationSound('line');
      showToast('เปิดเสียงแจ้งเตือนข้อความใหม่แล้ว');
    } else {
      showToast('ปิดเสียงแจ้งเตือนแล้ว');
    }
  });

  // Top notification buttons: jump to platform unread chats
  const jumpToPlatformUnread = async (platform) => {
    state.filter.platform = platform;
    state.filter.channelId = 'all';
    state.filter.box = 'unreplied';
    syncTopNavActive();
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.box === 'unreplied'));
    renderChannels();
    await loadConversations();
    const firstUnread = state.conversations.find((c) => Number(c.unread_count || 0) > 0);
    if (firstUnread) {
      await selectConversation(firstUnread.id);
    }
  };
  els.lineNotifyBtn.addEventListener('click', () => jumpToPlatformUnread('line'));
  els.fbNotifyBtn.addEventListener('click', () => jumpToPlatformUnread('facebook'));

  // Close active chat via Esc (respecting slash menu & open dialogs first)
  els.closeChatBtn.addEventListener('click', closeActiveConversation);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.slashMenu.classList.contains('hidden')) {
      e.preventDefault();
      hideSlashMenu();
      return;
    }
    if (
      els.simulatorDialog.open ||
      els.addChannelDialog.open ||
      els.addQuickReplyDialog.open ||
      els.manageQuickRepliesDialog.open ||
      els.campaignsDialog.open ||
      els.changePwDialog.open ||
      els.agentsDialog.open ||
      els.manageChannelsDialog.open ||
      els.lightboxDialog.open
    ) {
      return;
    }
    if (state.activeConversationId) {
      e.preventDefault();
      closeActiveConversation();
    }
  });

  // Floating jump-to-latest button inside chat thread
  els.jumpNewMsgBtn.addEventListener('click', () => {
    els.messageList.scrollTop = els.messageList.scrollHeight;
    els.jumpNewMsgBtn.classList.add('hidden');
  });
  els.messageList.addEventListener('scroll', () => {
    const nearBottom =
      els.messageList.scrollHeight - els.messageList.scrollTop - els.messageList.clientHeight < 40;
    if (nearBottom) els.jumpNewMsgBtn.classList.add('hidden');
  });

  // Top platform filters
  document.querySelectorAll('.nav-item[data-filter-platform]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter.platform = btn.dataset.filterPlatform;
      state.filter.channelId = 'all';
      syncTopNavActive();
      renderChannels();
      loadConversations();
    });
  });

  // Inbox box tabs (รอตอบ / ตอบแล้ว / ปิดงาน / ทั้งหมด)
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter.box = btn.dataset.box;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      loadConversations();
    });
  });

  // Search debounce
  let searchTimer;
  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filter.q = els.searchInput.value;
      loadConversations();
    }, 200);
  });

  // Login Form + Quick Demo Fill
  document.querySelectorAll('.demo-cred-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      els.loginEmail.value = btn.dataset.demoEmail;
      els.loginPassword.value = btn.dataset.demoPass;
      els.loginErrorBox.classList.add('hidden');
      els.loginForm.requestSubmit();
    });
  });

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.loginErrorBox.classList.add('hidden');
    els.loginSubmitBtn.disabled = true;
    els.loginSubmitBtn.textContent = 'กำลังเข้าสู่ระบบ...';
    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: els.loginEmail.value.trim(),
          password: els.loginPassword.value,
        }),
      });
      els.loginPassword.value = '';
      await startAuthenticatedSession(res.user);
    } catch (err) {
      els.loginErrorBox.textContent = err.message;
      els.loginErrorBox.classList.remove('hidden');
    } finally {
      els.loginSubmitBtn.disabled = false;
      els.loginSubmitBtn.textContent = 'เข้าสู่ระบบ';
    }
  });

  // Logout
  els.logoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    showLoginScreen();
    showToast('ออกจากระบบเรียบร้อยแล้ว');
  });

  // Change Own Password
  els.openChangePwBtn.addEventListener('click', () => {
    els.changePwForm.reset();
    els.changePwDialog.showModal();
  });
  els.changePwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: els.curPwInput.value,
          newPassword: els.newPwInput.value,
        }),
      });
      els.changePwForm.reset();
      els.changePwDialog.close();
      showToast('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
    } catch (err) {
      showToast(`เปลี่ยนรหัสไม่สำเร็จ: ${err.message}`);
    }
  });

  // Team & RBAC Management (Supervisor / Admin)
  els.openAgentsBtn.addEventListener('click', async () => {
    els.agentEditorForm.classList.add('hidden');
    els.agentsDialog.showModal();
    await loadAgentsManagementList();
  });
  els.openNewAgentFormBtn.addEventListener('click', () => openAgentEditor(null));
  els.cancelAgentEditorBtn.addEventListener('click', () => els.agentEditorForm.classList.add('hidden'));
  els.agRoleSelect.addEventListener('change', toggleAgentShopsVisibility);

  els.agentEditorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const checkedChannels = Array.from(els.agShopCheckboxes.querySelectorAll('input[type="checkbox"]:checked')).map(
      (cb) => cb.value
    );
    const payload = {
      displayName: els.agNameInput.value.trim(),
      email: els.agEmailInput.value.trim(),
      role: els.agRoleSelect.value,
      channelIds: checkedChannels,
    };
    if (els.agPasswordInput.value) {
      payload.password = els.agPasswordInput.value;
    }

    try {
      if (state.editingAgentId) {
        await api(`/api/agents/${state.editingAgentId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('อัปเดตสิทธิ์แอดมินเรียบร้อย');
      } else {
        await api('/api/agents', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('เพิ่มบัญชีแอดมินใหม่เรียบร้อย');
      }
      els.agentEditorForm.classList.add('hidden');
      state.editingAgentId = null;
      await loadAgentsManagementList();
    } catch (err) {
      showToast(`บันทึกไม่สำเร็จ: ${err.message}`);
    }
  });

  els.escalateBtn.addEventListener('click', async () => {
    if (!state.activeConversation) return;
    const nextStatus = state.activeConversation.status === 'pending' ? 'open' : 'pending';
    await updateActiveConvMeta({ status: nextStatus });
    showToast(
      nextStatus === 'pending'
        ? 'ย้ายแชทไปโฟลเดอร์ "🚩 ต้องดำเนินการ" เรียบร้อยแล้ว'
        : 'นำแชทออกจากโฟลเดอร์ "ต้องดำเนินการ" เรียบร้อยแล้ว'
    );
  });

  els.assignAgentSelect.addEventListener('change', () => {
    updateActiveConvMeta({ assignedAgentId: els.assignAgentSelect.value || null });
  });

  els.convStatusSelect.addEventListener('change', () => {
    updateActiveConvMeta({ status: els.convStatusSelect.value });
  });

  // Image Attach Button + File Input + Cancel
  els.attachImageBtn.addEventListener('click', () => els.imageFileInput.click());
  els.imageFileInput.addEventListener('change', async () => {
    const file = els.imageFileInput.files?.[0];
    els.imageFileInput.value = '';
    if (file) await handleImageFile(file);
  });
  els.cancelPendingImageBtn.addEventListener('click', () => {
    state.pendingImage = null;
    renderPendingImage();
  });

  // Paste image (Ctrl+V / Cmd+V) straight into chat textarea
  els.replyInput.addEventListener('paste', async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find((item) => item.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (file) await handleImageFile(file);
    }
  });

  // Drag & Drop image onto active chat workspace
  let dragDepth = 0;
  els.chatWorkspace.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth += 1;
    els.dropOverlay.classList.remove('hidden');
  });
  els.chatWorkspace.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
  });
  els.chatWorkspace.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) els.dropOverlay.classList.add('hidden');
  });
  els.chatWorkspace.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    els.dropOverlay.classList.add('hidden');
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleImageFile(file);
  });

  // Lightbox backdrop click to close
  els.lightboxDialog.addEventListener('click', (e) => {
    if (e.target === els.lightboxDialog) els.lightboxDialog.close();
  });

  // Slash Command menu + Typing presence broadcast
  els.replyInput.addEventListener('input', () => {
    updateSlashMenu();
    if (state.activeConversationId) {
      reportPresence({ conversationId: state.activeConversationId, isTyping: true });
      clearTimeout(typingIdleTimer);
      typingIdleTimer = setTimeout(() => {
        if (state.activeConversationId) {
          reportPresence({ conversationId: state.activeConversationId, isTyping: false });
        }
      }, 2500);
    }
  });

  els.replyInput.addEventListener('keydown', (e) => {
    const slashOpen = !els.slashMenu.classList.contains('hidden');
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.slashSelectedIndex = (state.slashSelectedIndex + 1) % state.slashMatches.length;
        renderSlashMenu();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.slashSelectedIndex =
          (state.slashSelectedIndex - 1 + state.slashMatches.length) % state.slashMatches.length;
        renderSlashMenu();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySlashSelection();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      els.replyForm.requestSubmit();
    }
  });

  // Reply submit (text and/or image)
  els.replyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.activeConversationId) return;
    const text = els.replyInput.value.trim();
    const pendingImg = state.pendingImage;
    if (!text && !pendingImg) return;

    try {
      els.replyInput.value = '';
      state.pendingImage = null;
      renderPendingImage();
      hideSlashMenu();
      clearTimeout(typingIdleTimer);
      reportPresence({ conversationId: state.activeConversationId, isTyping: false });

      const res = await api(`/api/conversations/${state.activeConversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          text,
          agentId: state.currentAgentId,
          messageType: pendingImg ? 'image' : 'text',
          mediaUrl: pendingImg ? pendingImg.url : null,
        }),
      });
      await loadConversations();
      showToast(`ส่งข้อความสำเร็จ (${res.delivery.deliveryMethod}) — ย้ายไปกล่อง "ตอบแล้ว"`);
    } catch (err) {
      els.replyInput.value = text;
      state.pendingImage = pendingImg;
      renderPendingImage();
      showToast(`ส่งไม่สำเร็จ: ${err.message}`);
    }
  });

  // Tags & Notes
  els.addTagForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tag = els.newTagInput.value.trim();
    if (!tag || !state.activeConversationId) return;
    const currentTags = state.activeConversation?.customer_tags || [];
    if (!currentTags.includes(tag)) {
      await updateActiveConvMeta({ tags: [...currentTags, tag] });
    }
    els.newTagInput.value = '';
  });

  els.saveNotesBtn.addEventListener('click', async () => {
    await updateActiveConvMeta({ notes: els.customerNotesInput.value });
    showToast('บันทึกโน้ตลูกค้าเรียบร้อย');
  });

  // Manage Channels & Edit Live Tokens (Supervisor / Admin)
  els.openManageChannelsBtn.addEventListener('click', () => {
    els.editChannelForm.classList.add('hidden');
    state.editingChannelId = null;
    renderManageChannelsList();
    els.manageChannelsDialog.showModal();
  });
  els.cancelEditChannelBtn.addEventListener('click', () => {
    els.editChannelForm.classList.add('hidden');
    state.editingChannelId = null;
  });
  els.editChannelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.editingChannelId) return;
    const payload = {
      name: els.editChName.value.trim(),
      externalChannelId: els.editChExternalId.value.trim(),
    };
    if (els.editChAccessToken.value.trim()) {
      payload.accessToken = els.editChAccessToken.value.trim();
    }
    if (els.editChSecret.value.trim()) {
      payload.channelSecret = els.editChSecret.value.trim();
    }
    try {
      await api(`/api/channels/${state.editingChannelId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      els.editChannelForm.classList.add('hidden');
      state.editingChannelId = null;
      const refreshed = await api('/api/channels');
      state.channels = refreshed.channels;
      renderChannels();
      renderManageChannelsList();
      showToast('บันทึกการตั้งค่าร้านค้าและเข้ารหัส Token เรียบร้อยแล้ว');
    } catch (err) {
      showToast(`บันทึกไม่สำเร็จ: ${err.message}`);
    }
  });

  // Dialog openers/closers
  document.getElementById('openSimulatorBtn').addEventListener('click', () => els.simulatorDialog.showModal());
  document.getElementById('openAddChannelBtn').addEventListener('click', () => els.addChannelDialog.showModal());
  els.openAddQuickReplyBtn.addEventListener('click', () => openQuickReplyEditor(null));
  els.openManageQuickReplyBtn.addEventListener('click', () => {
    renderManageQuickRepliesList();
    els.manageQuickRepliesDialog.showModal();
  });
  els.qrManageScopeSelect.addEventListener('change', renderManageQuickRepliesList);
  els.qrManageAddNewBtn.addEventListener('click', () => openQuickReplyEditor(null));
  document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
    btn.addEventListener('click', () => document.getElementById(btn.dataset.closeDialog).close());
  });

  // Quick Reply modal live preview + image attach/paste
  els.qrContentInput.addEventListener('input', updateQrModalLivePreview);
  els.qrAttachImageBtn.addEventListener('click', () => els.qrImageFileInput.click());
  els.qrImageFileInput.addEventListener('change', async () => {
    const file = els.qrImageFileInput.files?.[0];
    els.qrImageFileInput.value = '';
    if (file) await handleQrModalImageFile(file);
  });
  els.qrRemoveImageBtn.addEventListener('click', () => {
    state.qrModalImage = null;
    updateQrModalLivePreview();
  });
  els.qrContentInput.addEventListener('paste', async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find((item) => item.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (file) await handleQrModalImageFile(file);
    }
  });

  // Add / Edit Quick Reply submit
  els.addQuickReplyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const contentText = els.qrContentInput.value.trim();
    const mediaUrl = state.qrModalImage?.url || null;
    if (!contentText && !mediaUrl) {
      showToast('กรุณาใส่ข้อความตอบกลับหรือแนบรูปภาพอย่างน้อย 1 อย่าง');
      return;
    }

    const isEditing = Boolean(state.editingQrId);
    const url = isEditing ? `/api/quick-replies/${state.editingQrId}` : '/api/quick-replies';
    const method = isEditing ? 'PATCH' : 'POST';

    try {
      await api(url, {
        method,
        body: JSON.stringify({
          channelId: els.qrChannelSelect.value || null,
          shortcut: els.qrShortcutInput.value.trim(),
          title: els.qrTitleInput.value.trim(),
          contentText,
          mediaUrl,
        }),
      });
      els.addQuickReplyForm.reset();
      state.qrModalImage = null;
      state.editingQrId = null;
      updateQrModalLivePreview();
      els.addQuickReplyDialog.close();
      showToast(isEditing ? 'แก้ไขข้อความตอบด่วนเรียบร้อย' : 'บันทึกข้อความตอบด่วนเรียบร้อย');
    } catch (err) {
      showToast(`บันทึกไม่สำเร็จ: ${err.message}`);
    }
  });

  // Campaign & Voucher Manager (.xls Import / Export)
  els.openCampaignsBtn.addEventListener('click', async () => {
    renderCampaignSelectors();
    els.campaignsDialog.showModal();
    if (els.campManageSelect.value) {
      await loadCampaignVouchers(els.campManageSelect.value);
    }
  });

  els.campManageSelect.addEventListener('change', () => {
    loadCampaignVouchers(els.campManageSelect.value);
  });

  els.toggleNewCampBtn.addEventListener('click', () => {
    els.newCampaignForm.classList.toggle('hidden');
  });
  els.cancelNewCampBtn.addEventListener('click', () => {
    els.newCampaignForm.classList.add('hidden');
  });

  els.newCampaignForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: els.newCampName.value.trim(),
          minConfidence: Number(els.newCampMinConf.value || 90),
          requiredRules: els.newCampRules.value.trim(),
          replyTemplate: els.newCampTemplate.value.trim(),
        }),
      });
      els.newCampaignForm.reset();
      els.newCampMinConf.value = '90';
      els.newCampaignForm.classList.add('hidden');
      const boot = await api('/api/campaigns');
      state.campaigns = boot.campaigns;
      renderCampaignSelectors();
      els.campManageSelect.value = res.campaign.id;
      await loadCampaignVouchers(res.campaign.id);
      showToast('สร้างกิจกรรมใหม่เรียบร้อยแล้ว');
    } catch (err) {
      showToast(`สร้างกิจกรรมไม่สำเร็จ: ${err.message}`);
    }
  });

  els.uploadXlsBtn.addEventListener('click', () => els.xlsFileInput.click());
  els.xlsFileInput.addEventListener('change', async () => {
    const file = els.xlsFileInput.files?.[0];
    els.xlsFileInput.value = '';
    const campId = els.campManageSelect.value;
    if (!file || !campId) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      const base64 = String(dataUrl).split(',')[1] || '';
      const res = await api(`/api/campaigns/${campId}/vouchers/import`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, fileBase64: base64 }),
      });
      await loadCampaignVouchers(campId);
      showToast(`นำเข้าไฟล์ ${file.name} สำเร็จ: เพิ่ม ${res.inserted} โค้ด (ซ้ำ ${res.skipped})`);
    } catch (err) {
      showToast(`นำเข้าไฟล์ไม่สำเร็จ: ${err.message}`);
    }
  });

  els.importPastedCodesBtn.addEventListener('click', async () => {
    const campId = els.campManageSelect.value;
    const raw = els.pasteCodesInput.value.trim();
    if (!campId || !raw) return;
    const normalized = raw.replace(/[,;\s]+/g, '\n');
    try {
      const res = await api(`/api/campaigns/${campId}/vouchers/import`, {
        method: 'POST',
        body: JSON.stringify({ filename: 'pasted.csv', rawText: normalized }),
      });
      els.pasteCodesInput.value = '';
      await loadCampaignVouchers(campId);
      showToast(`เพิ่มโค้ดสำเร็จ ${res.inserted} โค้ด (ซ้ำ ${res.skipped})`);
    } catch (err) {
      showToast(`เพิ่มโค้ดไม่สำเร็จ: ${err.message}`);
    }
  });

  // Right Panel: Run AI Evidence Verification on selected multi-image bundle
  els.verifyCampaignSelect.addEventListener('change', renderAiVerdict);
  els.runAiVerifyBtn.addEventListener('click', async () => {
    if (!state.activeConversationId) return;
    const campaignId = els.verifyCampaignSelect.value;
    const imageUrls = Array.from(state.selectedEvidenceUrls);
    if (!campaignId || imageUrls.length === 0) return;

    try {
      els.runAiVerifyBtn.disabled = true;
      els.runAiVerifyBtn.textContent = '⏳ AI กำลังวิเคราะห์รูปหลักฐาน...';
      const res = await api(`/api/conversations/${state.activeConversationId}/verify-evidence`, {
        method: 'POST',
        body: JSON.stringify({
          campaignId,
          imageUrls,
          mockScenario: els.mockAiScenarioSelect.value || 'auto',
        }),
      });
      await loadConversationSubmissions(state.activeConversationId);
      const v = res.submission.ai_verdict;
      showToast(
        v === 'pass'
          ? `AI ตรวจผ่าน ${res.submission.ai_confidence}% — กดปุ่มอนุมัติเพื่อแจกโค้ดได้เลย!`
          : v === 'fraud'
            ? `เตือน Fraud! ${res.submission.ai_summary}`
            : `ความมั่นใจ ${res.submission.ai_confidence}% (ต่ำกว่าเกณฑ์ 90%)`
      );
    } catch (err) {
      showToast(`ตรวจหลักฐานไม่สำเร็จ: ${err.message}`);
    } finally {
      els.runAiVerifyBtn.textContent = '🔍 ให้ AI ตรวจหลักฐาน (เกณฑ์ ≥ 90%)';
      renderEvidencePicker();
    }
  });

  els.runManualFallbackBtn.addEventListener('click', async () => {
    if (!state.activeConversationId) return;
    const campaignId = els.verifyCampaignSelect.value;
    const imageUrls = Array.from(state.selectedEvidenceUrls);
    if (!campaignId || imageUrls.length === 0) return;

    try {
      els.runManualFallbackBtn.disabled = true;
      els.runManualFallbackBtn.textContent = '⏳ กำลังตรวจรูปซ้ำ (SHA-256)...';
      const res = await api(`/api/conversations/${state.activeConversationId}/verify-evidence`, {
        method: 'POST',
        body: JSON.stringify({ campaignId, imageUrls, manualFallback: true }),
      });
      await loadConversationSubmissions(state.activeConversationId);
      if (res.submission.ai_verdict === 'fraud') {
        showToast(`เตือน Fraud! ${res.submission.ai_summary}`);
      } else {
        showToast('ตรวจรูปซ้ำผ่านแล้ว — Supervisor กดปุ่ม "อนุมัติแจกโค้ด (Manual Override)" ได้เลย');
      }
    } catch (err) {
      showToast(`ตรวจแบบ Manual ไม่สำเร็จ: ${err.message}`);
    } finally {
      els.runManualFallbackBtn.textContent = '🛡 ตรวจเองโดย Supervisor (ไม่ใช้ AI)';
      renderEvidencePicker();
    }
  });

  // Simulator multi-image evidence helpers
  els.simPickImagesBtn.addEventListener('click', () => els.simImageFilesInput.click());
  els.simImageFilesInput.addEventListener('change', async () => {
    const files = Array.from(els.simImageFilesInput.files || []);
    els.simImageFilesInput.value = '';
    for (const f of files) {
      try {
        const dataUrl = await fileToDataUrl(f);
        const up = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ dataUrl }) });
        state.simImageUrls.push(up.url);
      } catch (err) {
        showToast(`อัปโหลดรูปจำลองไม่สำเร็จ: ${err.message}`);
      }
    }
    renderSimImagePreviews();
  });
  els.simGen2ProofsBtn.addEventListener('click', async () => {
    try {
      els.simGen2ProofsBtn.disabled = true;
      const img1 = await generateAndUploadMockProof('1. กดไลก์เพจแล้ว ✅', 'Status: Liked & Following Page', '#dcfce7');
      const img2 = await generateAndUploadMockProof('2. แชร์เปิดสาธารณะ 🌐', 'Privacy: Public (Globe Icon)', '#dbeafe');
      state.simImageUrls.push(img1, img2);
      renderSimImagePreviews();
      showToast('แนบรูปหลักฐานจำลอง 2 รูปแล้ว พร้อมยิง Webhook');
    } catch (err) {
      showToast(`สร้างรูปจำลองไม่สำเร็จ: ${err.message}`);
    } finally {
      els.simGen2ProofsBtn.disabled = false;
    }
  });
  els.simClearImagesBtn.addEventListener('click', () => {
    state.simImageUrls = [];
    renderSimImagePreviews();
  });

  // Simulator submit
  els.simulatorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/simulator/inbound', {
        method: 'POST',
        body: JSON.stringify({
          channelId: els.simChannelSelect.value,
          customerName: els.simCustomerName.value.trim(),
          externalUserId: els.simExternalUserId.value.trim() || undefined,
          text: els.simMessageText.value.trim(),
          mediaUrls: state.simImageUrls,
        }),
      });
      state.simImageUrls = [];
      renderSimImagePreviews();
      els.simulatorDialog.close();
      const firstConv = res.results?.[0]?.conversation;
      if (firstConv && firstConv.id !== state.activeConversationId) {
        showToast(
          `ยิงจำลองสำเร็จ: ข้อความใหม่ [${firstConv.platform === 'line' ? 'LINE' : 'FB'} ${firstConv.shop_code}]`,
          {
            platform: firstConv.platform,
            onClick: () => selectConversation(firstConv.id),
          }
        );
      } else {
        showToast('ยิง Webhook จำลองสำเร็จ!');
      }
    } catch (err) {
      showToast(`เกิดข้อผิดพลาด: ${err.message}`);
    }
  });

  // Add Channel submit
  els.addChannelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/channels', {
        method: 'POST',
        body: JSON.stringify({
          platform: document.getElementById('newChPlatform').value,
          shopCode: document.getElementById('newChCode').value.trim(),
          name: document.getElementById('newChName').value.trim(),
          externalChannelId: document.getElementById('newChExternalId').value.trim(),
          accessToken: document.getElementById('newChAccessToken').value.trim() || undefined,
          channelSecret: document.getElementById('newChSecret').value.trim() || undefined,
        }),
      });
      els.addChannelForm.reset();
      els.addChannelDialog.close();
      showToast('เพิ่มร้านค้าใหม่เรียบร้อยแล้ว');
    } catch (err) {
      showToast(`เพิ่มร้านค้าไม่สำเร็จ: ${err.message}`);
    }
  });

  // Clear presence cleanly when tab unloads
  window.addEventListener('beforeunload', () => {
    if (state.activeConversationId && navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/presence',
        new Blob([JSON.stringify({ clientId: state.clientId, conversationId: null })], { type: 'application/json' })
      );
    }
  });

  // Refresh SLA timers every 30s so wait duration stays live
  setInterval(() => {
    renderConversations();
  }, 30_000);
}

function showLoginScreen(errorMsg = '') {
  disconnectSse();
  state.currentUser = null;
  state.activeConversationId = null;
  state.activeConversation = null;
  state.activeMessages = [];
  state.conversations = [];
  els.appShell.classList.add('hidden');
  els.loginScreen.classList.remove('hidden');
  document.title = BASE_TITLE;
  if (errorMsg) {
    els.loginErrorBox.textContent = errorMsg;
    els.loginErrorBox.classList.remove('hidden');
  } else {
    els.loginErrorBox.classList.add('hidden');
  }
}

async function startAuthenticatedSession(user) {
  state.currentUser = user;
  state.currentAgentId = user.id;
  state.filter.platform = 'all';
  state.filter.channelId = 'all';
  state.filter.box = 'unreplied';
  state.activeConversationId = null;
  state.activeConversation = null;
  state.activeMessages = [];

  els.loginScreen.classList.add('hidden');
  els.appShell.classList.remove('hidden');

  const boot = await api('/api/bootstrap');
  state.currentUser = boot.user || user;
  state.currentAgentId = state.currentUser.id;
  state.brandName = boot.brandName || 'DmCare';
  state.isProduction = Boolean(boot.isProduction);
  state.dbEngine = boot.dbEngine || 'sqlite';
  state.storageProvider = boot.storageProvider || 'local-disk';
  state.channels = boot.channels;
  state.agents = boot.agents;
  state.quickReplies = boot.quickReplies;
  state.campaigns = boot.campaigns || [];
  state.geminiEnabled = Boolean(boot.geminiEnabled);
  state.liveDeliveryEnabled = Boolean(boot.liveDeliveryEnabled);
  state.publicBaseUrl = boot.publicBaseUrl || '';
  state.presence = boot.presence || {};

  applyEnvironmentMode();
  renderCurrentUserCard();
  syncTopNavActive();
  renderChannels();
  renderAgents();
  renderQuickReplies();
  renderCampaignSelectors();
  renderActiveChat(null);
  await loadConversations();

  connectSse();
}

async function init() {
  updateSoundButtonUI();
  bindEvents();
  const me = await api('/api/auth/me');
  state.isProduction = Boolean(me.isProduction);
  state.brandName = me.brandName || 'DmCare';
  applyEnvironmentMode();
  if (me.authenticated && me.user) {
    await startAuthenticatedSession(me.user);
  } else {
    showLoginScreen();
  }
}

init().catch((err) => {
  console.error(err);
  showToast(`โหลดระบบไม่สำเร็จ: ${err.message}`);
});
