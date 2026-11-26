const BASE_TITLE = 'DmCare Inbox — รวมแชท LINE (a1–a5) & Facebook (b1–b5)';

const state = {
  clientId: (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  brandName: 'DmCare',
  isProduction: false,
  dbEngine: 'sqlite',
  storageProvider: 'local-disk',
  workspace: null,
  workspaces: [],
  editingWorkspaceId: null,
  channels: [],
  agents: [],
  quickReplies: [],
  customStickers: [],
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
  loginTotpForm: document.getElementById('loginTotpForm'),
  loginTotpHint: document.getElementById('loginTotpHint'),
  loginTotpCode: document.getElementById('loginTotpCode'),
  loginTotpErrorBox: document.getElementById('loginTotpErrorBox'),
  loginTotpSubmitBtn: document.getElementById('loginTotpSubmitBtn'),
  loginTotpBackBtn: document.getElementById('loginTotpBackBtn'),
  loginDemoBox: document.getElementById('loginDemoBox'),
  forcePwScreen: document.getElementById('forcePwScreen'),
  forcePwSubtitle: document.getElementById('forcePwSubtitle'),
  forcePwForm: document.getElementById('forcePwForm'),
  forceCurPw: document.getElementById('forceCurPw'),
  forceNewPw: document.getElementById('forceNewPw'),
  forceConfirmPw: document.getElementById('forceConfirmPw'),
  forcePwErrorBox: document.getElementById('forcePwErrorBox'),
  forcePwSubmitBtn: document.getElementById('forcePwSubmitBtn'),
  forcePwLogoutBtn: document.getElementById('forcePwLogoutBtn'),
  supportModeBanner: document.getElementById('supportModeBanner'),
  supportModeText: document.getElementById('supportModeText'),
  exitSupportModeBtn: document.getElementById('exitSupportModeBtn'),
  openSimulatorBtn: document.getElementById('openSimulatorBtn'),
  chatEmptyHint: document.getElementById('chatEmptyHint'),
  appShell: document.getElementById('appShell'),
  sidebarBrand: document.getElementById('sidebarBrand'),
  sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
  sseStatus: document.getElementById('sseStatus'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  totalUnreadBadge: document.getElementById('totalUnreadBadge'),
  lineUnreadBadge: document.getElementById('lineUnreadBadge'),
  fbUnreadBadge: document.getElementById('fbUnreadBadge'),
  toggleLineGroupBtn: document.getElementById('toggleLineGroupBtn'),
  toggleFbGroupBtn: document.getElementById('toggleFbGroupBtn'),
  lineChannelCount: document.getElementById('lineChannelCount'),
  fbChannelCount: document.getElementById('fbChannelCount'),
  lineGroupUnreadBadge: document.getElementById('lineGroupUnreadBadge'),
  fbGroupUnreadBadge: document.getElementById('fbGroupUnreadBadge'),
  miniTotalDot: document.getElementById('miniTotalDot'),
  miniLineDot: document.getElementById('miniLineDot'),
  miniFbDot: document.getElementById('miniFbDot'),
  miniDashboardBtn: document.getElementById('miniDashboardBtn'),
  miniSaasBtn: document.getElementById('miniSaasBtn'),
  miniCampaignsBtn: document.getElementById('miniCampaignsBtn'),
  miniManageChannelsBtn: document.getElementById('miniManageChannelsBtn'),
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
  workspaceBadgeBar: document.getElementById('workspaceBadgeBar'),
  wsBadgeName: document.getElementById('wsBadgeName'),
  wsBadgePlan: document.getElementById('wsBadgePlan'),
  workspaceSwitcher: document.getElementById('workspaceSwitcher'),
  openDashboardBtn: document.getElementById('openDashboardBtn'),
  openSaasAdminBtn: document.getElementById('openSaasAdminBtn'),
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
  markRepliedBtn: document.getElementById('markRepliedBtn'),
  escalateBtn: document.getElementById('escalateBtn'),
  assignAgentSelect: document.getElementById('assignAgentSelect'),
  convStatusSelect: document.getElementById('convStatusSelect'),
  closeChatBtn: document.getElementById('closeChatBtn'),
  collisionBanner: document.getElementById('collisionBanner'),
  typingIndicatorBar: document.getElementById('typingIndicatorBar'),
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
  stickerPickerPopover: document.getElementById('stickerPickerPopover'),
  stickerPackTabs: document.getElementById('stickerPackTabs'),
  stickerGrid: document.getElementById('stickerGrid'),
  closeStickerPickerBtn: document.getElementById('closeStickerPickerBtn'),
  openStickerPickerBtn: document.getElementById('openStickerPickerBtn'),
  customStickerFileInput: document.getElementById('customStickerFileInput'),
  uploadCustomStickerBtn: document.getElementById('uploadCustomStickerBtn'),
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
  aiUpsellBox: document.getElementById('aiUpsellBox'),
  runAiVerifyBtn: document.getElementById('runAiVerifyBtn'),
  runManualFallbackBtn: document.getElementById('runManualFallbackBtn'),
  aiVerdictContainer: document.getElementById('aiVerdictContainer'),
  infoCustomerName: document.getElementById('infoCustomerName'),
  infoCustomerNameView: document.getElementById('infoCustomerNameView'),
  editCustomerNameBtn: document.getElementById('editCustomerNameBtn'),
  editCustomerNameForm: document.getElementById('editCustomerNameForm'),
  editCustomerNameInput: document.getElementById('editCustomerNameInput'),
  cancelCustomerNameBtn: document.getElementById('cancelCustomerNameBtn'),
  infoChannelName: document.getElementById('infoChannelName'),
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
  totpStatusPill: document.getElementById('totpStatusPill'),
  totpOffPanel: document.getElementById('totpOffPanel'),
  startTotpSetupBtn: document.getElementById('startTotpSetupBtn'),
  totpSetupPanel: document.getElementById('totpSetupPanel'),
  totpQrBox: document.getElementById('totpQrBox'),
  totpSecretText: document.getElementById('totpSecretText'),
  copyTotpSecretBtn: document.getElementById('copyTotpSecretBtn'),
  totpEnableForm: document.getElementById('totpEnableForm'),
  totpEnablePwInput: document.getElementById('totpEnablePwInput'),
  totpEnableCodeInput: document.getElementById('totpEnableCodeInput'),
  cancelTotpSetupBtn: document.getElementById('cancelTotpSetupBtn'),
  totpRecoveryBox: document.getElementById('totpRecoveryBox'),
  totpRecoveryGrid: document.getElementById('totpRecoveryGrid'),
  copyRecoveryCodesBtn: document.getElementById('copyRecoveryCodesBtn'),
  totpOnPanel: document.getElementById('totpOnPanel'),
  openDisableTotpBtn: document.getElementById('openDisableTotpBtn'),
  totpDisableForm: document.getElementById('totpDisableForm'),
  totpDisablePwInput: document.getElementById('totpDisablePwInput'),
  totpDisableCodeInput: document.getElementById('totpDisableCodeInput'),
  cancelTotpDisableBtn: document.getElementById('cancelTotpDisableBtn'),
  agentsDialog: document.getElementById('agentsDialog'),
  agentsQuotaPill: document.getElementById('agentsQuotaPill'),
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
  channelsQuotaPill: document.getElementById('channelsQuotaPill'),
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
  dashboardDialog: document.getElementById('dashboardDialog'),
  dashHeading: document.getElementById('dashHeading'),
  dashSubheading: document.getElementById('dashSubheading'),
  dashRangeSelect: document.getElementById('dashRangeSelect'),
  dashKpiGrid: document.getElementById('dashKpiGrid'),
  dashChannelsBody: document.getElementById('dashChannelsBody'),
  dashAgentsBody: document.getElementById('dashAgentsBody'),
  dashVoucherStats: document.getElementById('dashVoucherStats'),
  saasAdminDialog: document.getElementById('saasAdminDialog'),
  saasKpiGrid: document.getElementById('saasKpiGrid'),
  toggleNewWsBtn: document.getElementById('toggleNewWsBtn'),
  newWorkspaceForm: document.getElementById('newWorkspaceForm'),
  wsNameInput: document.getElementById('wsNameInput'),
  wsPlanSelect: document.getElementById('wsPlanSelect'),
  wsExpiresInput: document.getElementById('wsExpiresInput'),
  wsMaxChannelsInput: document.getElementById('wsMaxChannelsInput'),
  wsMaxAgentsInput: document.getElementById('wsMaxAgentsInput'),
  wsAiEnabledCheck: document.getElementById('wsAiEnabledCheck'),
  wsOwnerNameInput: document.getElementById('wsOwnerNameInput'),
  wsOwnerEmailInput: document.getElementById('wsOwnerEmailInput'),
  wsOwnerPasswordInput: document.getElementById('wsOwnerPasswordInput'),
  wsContactNotesInput: document.getElementById('wsContactNotesInput'),
  cancelNewWsBtn: document.getElementById('cancelNewWsBtn'),
  editWorkspaceForm: document.getElementById('editWorkspaceForm'),
  editWsHeading: document.getElementById('editWsHeading'),
  editWsName: document.getElementById('editWsName'),
  editWsPlan: document.getElementById('editWsPlan'),
  editWsExpires: document.getElementById('editWsExpires'),
  editWsMaxChannels: document.getElementById('editWsMaxChannels'),
  editWsMaxAgents: document.getElementById('editWsMaxAgents'),
  editWsAiEnabled: document.getElementById('editWsAiEnabled'),
  editWsContactNotes: document.getElementById('editWsContactNotes'),
  cancelEditWsBtn: document.getElementById('cancelEditWsBtn'),
  saasCredsBanner: document.getElementById('saasCredsBanner'),
  saasCredsTitle: document.getElementById('saasCredsTitle'),
  saasCredsText: document.getElementById('saasCredsText'),
  copySaasCredsBtn: document.getElementById('copySaasCredsBtn'),
  dismissSaasCredsBtn: document.getElementById('dismissSaasCredsBtn'),
  saasWorkspacesList: document.getElementById('saasWorkspacesList'),
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
let lastPresenceSent = { conversationId: null, isTyping: false, at: 0 };

async function reportPresence({
  conversationId = state.activeConversationId,
  isTyping = false,
  force = false,
} = {}) {
  const targetConvId = conversationId || null;
  const typingFlag = Boolean(isTyping && targetConvId);
  const now = Date.now();

  // Throttle repeated identical presence updates (avoid spamming POST /api/presence on every keystroke)
  if (
    !force &&
    lastPresenceSent.conversationId === targetConvId &&
    lastPresenceSent.isTyping === typingFlag &&
    now - lastPresenceSent.at < (typingFlag ? 2000 : 15000)
  ) {
    return;
  }

  lastPresenceSent = { conversationId: targetConvId, isTyping: typingFlag, at: now };

  try {
    await api('/api/presence', {
      method: 'POST',
      body: JSON.stringify({
        clientId: state.clientId,
        agentId: state.currentAgentId,
        conversationId: targetConvId,
        isTyping: typingFlag,
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
    els.collisionBanner.classList.remove('is-typing');
    if (els.typingIndicatorBar) els.typingIndicatorBar.classList.add('hidden');
    return;
  }
  const others = getOtherViewers(state.activeConversationId);
  if (others.length === 0) {
    els.collisionBanner.classList.add('hidden');
    els.collisionBanner.classList.remove('is-typing');
    if (els.typingIndicatorBar) els.typingIndicatorBar.classList.add('hidden');
    return;
  }

  const typingAgents = [...new Set(others.filter((o) => o.isTyping).map((o) => o.agentName))];
  const viewingAgents = [...new Set(others.filter((o) => !o.isTyping).map((o) => o.agentName))];

  const parts = [];
  if (typingAgents.length > 0) {
    parts.push(`✍️ ${typingAgents.join(', ')} กำลังพิมพ์ตอบลูกค้าในห้องนี้อยู่!`);
  }
  if (viewingAgents.length > 0) {
    parts.push(`👁 ${viewingAgents.join(', ')} กำลังเปิดดูห้องแชทนี้อยู่`);
  }

  els.collisionBanner.textContent = `⚠️ ${parts.join(' · ')} (ระวังตอบชนกัน)`;
  els.collisionBanner.classList.toggle('is-typing', typingAgents.length > 0);
  els.collisionBanner.classList.remove('hidden');

  if (els.typingIndicatorBar) {
    if (typingAgents.length > 0) {
      const dots = document.createElement('span');
      dots.className = 'typing-dots';
      dots.setAttribute('aria-hidden', 'true');
      dots.append(
        document.createElement('span'),
        document.createElement('span'),
        document.createElement('span')
      );
      const label = document.createElement('span');
      label.textContent = `✍️ ${typingAgents.join(', ')} กำลังพิมพ์ตอบแชทนี้อยู่...`;
      els.typingIndicatorBar.replaceChildren(dots, label);
      els.typingIndicatorBar.classList.remove('hidden');
    } else {
      els.typingIndicatorBar.classList.add('hidden');
    }
  }
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

const FB_EMOJI_STICKERS = [
  { id: 'fb_like', emoji: '👍', label: 'ถูกใจ', bg: '#eff6ff', accent: '#1877f2' },
  { id: 'fb_thanks', emoji: '🙏', label: 'ขอบคุณค่ะ/ครับ', bg: '#fef2f2', accent: '#e11d48' },
  { id: 'fb_love', emoji: '❤️', label: 'ยินดีมากครับ', bg: '#fff1f2', accent: '#f43f5e' },
  { id: 'fb_ok', emoji: '✅', label: 'รับออเดอร์แล้ว', bg: '#ecfdf5', accent: '#059669' },
  { id: 'fb_ship', emoji: '🚚', label: 'กำลังจัดส่ง', bg: '#eff6ff', accent: '#2563eb' },
  { id: 'fb_wait', emoji: '⏳', label: 'รอสักครู่นะครับ', bg: '#fffbeb', accent: '#d97706' },
  { id: 'fb_gift', emoji: '🎁', label: 'โปรพิเศษ', bg: '#f5f3ff', accent: '#7c3aed' },
  { id: 'fb_sorry', emoji: '🙇', label: 'ขออภัยด้วยครับ', bg: '#f8fafc', accent: '#475569' },
];

const LINE_STICKER_PACKS = [
  {
    id: 'fb_emoji',
    label: '👍 FB / ฮิต',
    kind: 'fb',
  },
  {
    id: 'custom',
    label: '⭐ ของร้าน',
    kind: 'custom',
  },
  {
    id: '11537',
    label: 'Brown',
    kind: 'line',
    stickers: ['52002734', '52002735', '52002736', '52002737', '52002738', '52002739', '52002740', '52002744'],
  },
  {
    id: '446',
    label: 'Moon',
    kind: 'line',
    stickers: ['1988', '1989', '1990', '1991', '1992', '1993', '1994', '1995'],
  },
  {
    id: '789',
    label: 'Friends',
    kind: 'line',
    stickers: ['10855', '10856', '10857', '10858', '10859', '10860', '10861', '10863'],
  },
];
let activeStickerPackId = '11537';
const uploadedEmojiStickerCache = new Map();

async function renderEmojiStickerToUploadedUrl(item) {
  if (uploadedEmojiStickerCache.has(item.id)) {
    return uploadedEmojiStickerCache.get(item.id);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  // Rounded sticker card
  ctx.fillStyle = item.bg;
  ctx.beginPath();
  ctx.roundRect(14, 14, 228, 228, 44);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = item.accent;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '116px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.fillText(item.emoji, 128, 108);

  ctx.fillStyle = item.accent;
  ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
  ctx.fillText(item.label, 128, 198);

  const dataUrl = canvas.toDataURL('image/png');
  const uploaded = await api('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ dataUrl }),
  });
  uploadedEmojiStickerCache.set(item.id, uploaded.url);
  return uploaded.url;
}

function renderStickerPicker() {
  const activePack = LINE_STICKER_PACKS.find((p) => p.id === activeStickerPackId) || LINE_STICKER_PACKS[0];
  els.stickerPackTabs.replaceChildren(
    ...LINE_STICKER_PACKS.map((pack) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const extraCls = pack.kind === 'fb' ? ' fb-tab' : pack.kind === 'custom' ? ' custom-tab' : '';
      btn.className = `sticker-pack-tab${extraCls}${pack.id === activePack.id ? ' active' : ''}`;
      btn.textContent = pack.label;
      btn.addEventListener('click', () => {
        activeStickerPackId = pack.id;
        renderStickerPicker();
      });
      return btn;
    })
  );

  if (activePack.kind === 'fb') {
    els.stickerGrid.replaceChildren(
      ...FB_EMOJI_STICKERS.map((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sticker-item-btn sticker-emoji-card';
        btn.style.background = item.bg;
        btn.title = `ส่งสติกเกอร์ "${item.label}"`;
        const ico = document.createElement('span');
        ico.className = 'stk-ico';
        ico.textContent = item.emoji;
        const lbl = document.createElement('span');
        lbl.className = 'stk-lbl';
        lbl.style.color = item.accent;
        lbl.textContent = item.label;
        btn.append(ico, lbl);
        btn.addEventListener('click', async () => {
          if (!state.activeConversationId) return;
          els.stickerPickerPopover.classList.add('hidden');
          try {
            const mediaUrl = await renderEmojiStickerToUploadedUrl(item);
            await api(`/api/conversations/${state.activeConversationId}/messages`, {
              method: 'POST',
              body: JSON.stringify({ messageType: 'sticker', mediaUrl }),
            });
            await loadConversations();
            showToast(`ส่งสติกเกอร์ "${item.label}" เรียบร้อยแล้ว`);
          } catch (err) {
            showToast(`ส่งสติกเกอร์ไม่สำเร็จ: ${err.message}`);
          }
        });
        return btn;
      })
    );
    return;
  }

  if (activePack.kind === 'custom') {
    if (!state.customStickers || state.customStickers.length === 0) {
      const empty = document.createElement('div');
      empty.style.gridColumn = '1 / -1';
      empty.style.padding = '18px 8px';
      empty.style.textAlign = 'center';
      empty.style.fontSize = '12px';
      empty.style.color = '#64748b';
      empty.textContent = 'ยังไม่มีสติกเกอร์ของร้าน กดปุ่ม "+ เพิ่มสติกเกอร์ร้าน" ด้านล่างเพื่ออัปโหลดได้เลย';
      els.stickerGrid.replaceChildren(empty);
      return;
    }
    els.stickerGrid.replaceChildren(
      ...state.customStickers.map((stk) => {
        const wrap = document.createElement('div');
        wrap.className = 'sticker-custom-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sticker-item-btn';
        btn.style.width = '100%';
        btn.title = stk.label || 'ส่งสติกเกอร์ของร้าน';
        const img = document.createElement('img');
        img.src = stk.media_url;
        img.alt = stk.label || 'สติกเกอร์ร้าน';
        img.loading = 'lazy';
        btn.append(img);
        btn.addEventListener('click', async () => {
          if (!state.activeConversationId) return;
          els.stickerPickerPopover.classList.add('hidden');
          try {
            await api(`/api/conversations/${state.activeConversationId}/messages`, {
              method: 'POST',
              body: JSON.stringify({ messageType: 'sticker', mediaUrl: stk.media_url }),
            });
            await loadConversations();
            showToast('ส่งสติกเกอร์ของร้านเรียบร้อยแล้ว');
          } catch (err) {
            showToast(`ส่งสติกเกอร์ไม่สำเร็จ: ${err.message}`);
          }
        });

        const delX = document.createElement('button');
        delX.type = 'button';
        delX.className = 'sticker-del-x';
        delX.textContent = '×';
        delX.title = 'ลบสติกเกอร์นี้';
        delX.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await api(`/api/stickers/${stk.id}`, { method: 'DELETE' });
            state.customStickers = state.customStickers.filter((s) => s.id !== stk.id);
            renderStickerPicker();
            showToast('ลบสติกเกอร์แล้ว');
          } catch (err) {
            showToast(err.message);
          }
        });

        wrap.append(btn, delX);
        return wrap;
      })
    );
    return;
  }

  els.stickerGrid.replaceChildren(
    ...activePack.stickers.map((sid) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sticker-item-btn';
      btn.title = `ส่งสติกเกอร์ #${sid}`;
      const img = document.createElement('img');
      img.src = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${sid}/android/sticker.png`;
      img.alt = `สติกเกอร์ ${sid}`;
      img.loading = 'lazy';
      btn.append(img);
      btn.addEventListener('click', async () => {
        if (!state.activeConversationId) return;
        els.stickerPickerPopover.classList.add('hidden');
        try {
          await api(`/api/conversations/${state.activeConversationId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
              messageType: 'sticker',
              stickerPackageId: activePack.id,
              stickerId: sid,
            }),
          });
          await loadConversations();
          showToast('ส่งสติกเกอร์เรียบร้อยแล้ว');
        } catch (err) {
          showToast(`ส่งสติกเกอร์ไม่สำเร็จ: ${err.message}`);
        }
      });
      return btn;
    })
  );
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
  updateBadge(els.lineGroupUnreadBadge, lineUnread);
  updateBadge(els.fbGroupUnreadBadge, fbUnread);
  updateBadge(els.miniTotalDot, totalUnread);
  updateBadge(els.miniLineDot, lineUnread);
  updateBadge(els.miniFbDot, fbUnread);
  if (els.lineChannelCount) els.lineChannelCount.textContent = String(lineChannels.length);
  if (els.fbChannelCount) els.fbChannelCount.textContent = String(fbChannels.length);
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
  btn.className = `nav-item${ch.is_active === false ? ' paused' : ''}`;
  if (state.filter.channelId === ch.id) btn.classList.add('active');

  const label = document.createElement('span');
  const dot = document.createElement('span');
  dot.className = `dot ${ch.platform}`;
  const pauseSuffix = ch.is_active === false ? ' (พัก)' : '';
  label.append(dot, `${ch.shop_code} · ${ch.name.replace(/^ร้าน |^เพจ /, '')}${pauseSuffix}`);

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
  document.querySelectorAll('.nav-item[data-filter-platform], .mini-rail-btn[data-filter-platform]').forEach((btn) => {
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
  const roleLabel = u.is_super_admin
    ? 'SUPER ADMIN · เจ้าของระบบ'
    : u.is_manager
      ? `${u.role.toUpperCase()} · เห็นทุกร้านในองค์กร`
      : `${u.role.toUpperCase()} · ${(u.channel_ids || []).length} ร้าน`;
  els.userRoleLabel.textContent = roleLabel;

  const isMgr = Boolean(u.is_manager);
  const isSuper = Boolean(u.is_super_admin);
  // Tier 3 Agent has NO Dashboard, NO channel settings, NO team management
  els.openDashboardBtn.classList.toggle('hidden', !isMgr);
  els.openSaasAdminBtn.classList.toggle('hidden', !isSuper);
  if (els.miniDashboardBtn) els.miniDashboardBtn.classList.toggle('hidden', !isMgr);
  if (els.miniSaasBtn) els.miniSaasBtn.classList.toggle('hidden', !isSuper);
  if (els.miniManageChannelsBtn) els.miniManageChannelsBtn.classList.toggle('hidden', !isMgr);
  els.openAgentsBtn.classList.toggle('hidden', !isMgr);
  if (els.openChangePwBtn) {
    els.openChangePwBtn.textContent = u.totp_enabled ? '🛡 2FA' : '🔑 รหัส';
    els.openChangePwBtn.title = u.totp_enabled
      ? 'เปิดใช้งาน 2FA อยู่แล้ว · คลิกเพื่อตั้งค่าความปลอดภัยหรือเปลี่ยนรหัสผ่าน'
      : 'เปลี่ยนรหัสผ่านและเปิดใช้งาน 2FA (Google Authenticator)';
    els.openChangePwBtn.classList.toggle('btn-2fa-active', Boolean(u.totp_enabled));
  }
  els.openManageChannelsBtn.classList.toggle('hidden', !isMgr);
  els.openAddChannelBtn.classList.toggle('hidden', !isMgr);
  els.toggleNewCampBtn.classList.toggle('hidden', !isMgr);
  els.uploadXlsBtn.classList.toggle('hidden', !isMgr);
  els.importPastedCodesBtn.classList.toggle('hidden', !isMgr);
  els.pasteCodesInput.classList.toggle('hidden', !isMgr);
  els.runManualFallbackBtn.classList.toggle('hidden', !isMgr);

  renderWorkspaceHeader();
}

function renderWorkspaceHeader() {
  const ws = state.workspace;
  if (ws) {
    els.wsBadgeName.textContent = ws.name;
    els.wsBadgePlan.textContent = (ws.plan_code || 'starter').toUpperCase();
    els.wsBadgePlan.className = `plan-badge ${ws.plan_code || 'starter'}`;
    els.workspaceBadgeBar.classList.remove('hidden');
  } else {
    els.workspaceBadgeBar.classList.add('hidden');
  }

  const isSuper = Boolean(state.currentUser?.is_super_admin);
  if (isSuper && Array.isArray(state.workspaces) && state.workspaces.length > 0) {
    els.workspaceSwitcher.replaceChildren(
      ...state.workspaces.map((w) => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `🏢 ${w.name} (${w.channel_count}/${w.max_channels} ร้าน)`;
        return opt;
      })
    );
    if (ws) els.workspaceSwitcher.value = ws.id;
    els.workspaceSwitcher.classList.remove('hidden');
  } else {
    els.workspaceSwitcher.classList.add('hidden');
  }

  // Enforce Support Mode Banner when Super Admin inspects a client workspace
  const inSupportMode = Boolean(isSuper && ws && ws.id !== 'ws_default');
  if (els.supportModeBanner) {
    els.supportModeBanner.classList.toggle('hidden', !inSupportMode);
    if (inSupportMode) {
      els.supportModeText.textContent = `👁 โหมด Support: กำลังเข้าดูองค์กร "${ws.name}" (ระวังเผลอส่งข้อความหาลูกค้าของร้านนี้)`;
    }
  }

  // Enforce AI Pro Subscription Gate in UI
  const aiAllowed = !ws || ws.ai_enabled !== false;
  els.aiUpsellBox.classList.toggle('hidden', aiAllowed);
  els.runAiVerifyBtn.classList.toggle('hidden', !aiAllowed);
  if (!aiAllowed) {
    els.mockAiScenarioSelect.classList.add('hidden');
  }
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
  if (els.agentsQuotaPill && state.workspace) {
    els.agentsQuotaPill.textContent = `ใช้ไป ${state.agents.length} / ${state.workspace.max_agents} คน`;
  }

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
    if (ag.totp_enabled) {
      const totpTag = document.createElement('span');
      totpTag.className = 'totp-status-pill on';
      totpTag.textContent = '🛡 2FA';
      head.append(totpTag);
    }

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

    if (ag.totp_enabled && ag.id !== state.currentUser?.id) {
      const reset2faBtn = document.createElement('button');
      reset2faBtn.type = 'button';
      reset2faBtn.className = 'btn btn-secondary compact';
      reset2faBtn.textContent = 'ปลดล็อก 2FA';
      reset2faBtn.title = 'รีเซ็ต 2FA กรณีแอดมินทำมือถือหาย';
      reset2faBtn.addEventListener('click', async () => {
        if (!window.confirm(`ยืนยันปลดล็อก 2FA ให้ ${ag.display_name} ใช่หรือไม่?`)) return;
        try {
          await api(`/api/agents/${ag.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ resetTotp: true }),
          });
          await loadAgentsManagementList();
          showToast(`ปลดล็อก 2FA ให้ ${ag.display_name} เรียบร้อยแล้ว`);
        } catch (err) {
          showToast(`ปลดล็อก 2FA ไม่สำเร็จ: ${err.message}`);
        }
      });
      actions.append(reset2faBtn);
    }

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
  const aiLabel = state.workspace?.ai_enabled === false
    ? '🔒 AI Pro ปิดอยู่'
    : state.geminiEnabled
      ? '🟢 Gemini AI Live'
      : '⚪ Mock AI';
  els.liveEnvBanner.textContent = `${envBadge} · ${dbLabel} · ${storageLabel} · ${modeLabel} · ${aiLabel} · ${baseLabel}`;
  if (els.channelsQuotaPill && state.workspace) {
    els.channelsQuotaPill.textContent = `ใช้ไป ${state.channels.length} / ${state.workspace.max_channels} ร้าน`;
  }

  if (state.channels.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '22px';
    empty.style.textAlign = 'center';
    empty.style.color = '#64748b';
    empty.style.fontSize = '13px';
    empty.textContent = 'ยังไม่มีร้านค้าในองค์กรนี้ กดปุ่ม "+ เพิ่มร้าน" ด้านซ้ายเพื่อเชื่อม LINE OA หรือ Facebook Page ได้เลย';
    els.manageChannelsList.replaceChildren(empty);
    return;
  }

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

    const activeBadge = document.createElement('span');
    activeBadge.className = `vch-status ${ch.is_active ? 'available' : 'claimed'}`;
    activeBadge.textContent = ch.is_active ? 'เปิดใช้งาน' : '⏸ พักชั่วคราว';

    head.append(pill, title, tokBadge, activeBadge);

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
    copyBtn.textContent = '📋 URL';
    copyBtn.title = 'คัดลอก Webhook URL';
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

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-secondary compact';
    toggleBtn.textContent = ch.is_active ? '⏸ พัก' : '▶ เปิด';
    toggleBtn.title = ch.is_active ? 'พักการใช้งานร้านชั่วคราว (ไม่ลบแชท)' : 'เปิดใช้งานร้านอีกครั้ง';
    toggleBtn.addEventListener('click', async () => {
      try {
        await api(`/api/channels/${ch.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !ch.is_active }),
        });
        const refreshed = await api('/api/channels');
        state.channels = refreshed.channels;
        renderChannels();
        renderManageChannelsList();
        showToast(ch.is_active ? `พักร้าน ${ch.name} ชั่วคราวแล้ว` : `เปิดใช้งานร้าน ${ch.name} แล้ว`);
      } catch (err) {
        showToast(`อัปเดตไม่สำเร็จ: ${err.message}`);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger compact';
    delBtn.textContent = '🗑 ลบ';
    delBtn.title = 'ลบร้านค้านี้ออกจากระบบ';
    delBtn.addEventListener('click', async () => {
      const convNote = ch.total_conversations > 0
        ? `\n⚠️ ร้านนี้มีประวัติแชททั้งหมด ${ch.total_conversations} ห้องที่จะถูกลบไปด้วย!`
        : '';
      if (!window.confirm(`ยืนยันลบร้าน "${ch.name}" (${ch.platform.toUpperCase()} ${ch.shop_code}) หรือไม่?${convNote}`)) {
        return;
      }
      try {
        await api(`/api/channels/${ch.id}`, { method: 'DELETE' });
        if (state.filter.channelId === ch.id) {
          state.filter.channelId = 'all';
        }
        if (state.activeConversation?.channel_id === ch.id) {
          closeActiveConversation();
        }
        const refreshed = await api('/api/channels');
        state.channels = refreshed.channels;
        renderChannels();
        renderManageChannelsList();
        await loadConversations();
        showToast(`ลบร้าน "${ch.name}" เรียบร้อยแล้ว`);
      } catch (err) {
        showToast(`ลบร้านไม่สำเร็จ: ${err.message}`);
      }
    });

    actions.append(copyBtn, editBtn, toggleBtn, delBtn);
    row.append(info, actions);
    return row;
  });

  els.manageChannelsList.replaceChildren(...nodes);
}

// -----------------------------------------------------------------------------
// 9. Workspace Dashboard (Tier 1 & Tier 2) + Super Admin SaaS Console (Tier 1)
// -----------------------------------------------------------------------------
function makeKpiCard(label, value, sub = '', accent = '') {
  const card = document.createElement('div');
  card.className = `dash-kpi-card${accent ? ` accent-${accent}` : ''}`;
  const sp = document.createElement('span');
  sp.textContent = label;
  const st = document.createElement('strong');
  st.textContent = String(value);
  card.append(sp, st);
  if (sub) {
    const sm = document.createElement('small');
    sm.textContent = sub;
    card.append(sm);
  }
  return card;
}

async function loadWorkspaceDashboard(range = els.dashRangeSelect.value || '30d') {
  try {
    const data = await api(`/api/dashboard?range=${encodeURIComponent(range)}`);
    renderWorkspaceDashboard(data);
  } catch (err) {
    showToast(`โหลด Dashboard ไม่สำเร็จ: ${err.message}`);
  }
}

function renderWorkspaceDashboard(data) {
  const ws = data.workspace || state.workspace || {};
  const s = data.summary || {};
  const v = data.vouchers || {};

  els.dashHeading.textContent = `📊 Dashboard — ${ws.name || 'DmCare'}`;
  const aiTag = ws.ai_enabled ? 'AI Pro: เปิดใช้งาน' : 'AI Pro: ปิด (Starter)';
  els.dashSubheading.textContent = `แพ็กเกจ ${(ws.plan_code || 'starter').toUpperCase()} · ร้านค้า ${ws.channels_used ?? 0}/${ws.max_channels ?? 0} · แอดมิน ${ws.agents_used ?? 0}/${ws.max_agents ?? 0} · ${aiTag}`;

  const avgSla = s.avgResponseMinutes != null ? `${s.avgResponseMinutes} นาที` : 'ยังไม่มีข้อมูล';
  els.dashKpiGrid.replaceChildren(
    makeKpiCard('ข้อความลูกค้าเข้า', s.inboundMessages ?? 0, `LINE ${s.lineInbound ?? 0} · FB ${s.fbInbound ?? 0}`, 'blue'),
    makeKpiCard('รอตอบ / ต้องดำเนินการ', `${s.unreplied ?? 0} / ${s.pending ?? 0}`, `แชททั้งหมด ${s.all ?? 0} ห้อง`, 'amber'),
    makeKpiCard('เวลาตอบเฉลี่ย (SLA)', avgSla, `คำนวณจาก ${s.measuredReplies ?? 0} รอบตอบ`, 'purple'),
    makeKpiCard('ปิดงานแล้ว (Resolved)', s.resolved ?? 0, `แอดมินส่งออก ${s.outboundMessages ?? 0} ข้อความ`, 'green')
  );

  // Channels + LINE Reply API 25,000 Quota Bars
  const chList = data.channels || [];
  if (chList.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.style.textAlign = 'center';
    td.style.color = '#64748b';
    td.textContent = 'ยังไม่มีร้านค้าในองค์กรนี้';
    tr.append(td);
    els.dashChannelsBody.replaceChildren(tr);
  } else {
    els.dashChannelsBody.replaceChildren(
      ...chList.map((ch) => {
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        const pill = document.createElement('span');
        pill.className = `channel-pill ${ch.platform}`;
        pill.textContent = `${ch.platform === 'line' ? 'LINE' : 'FB'} ${ch.shop_code}`;
        tdName.append(pill, ` ${ch.name}`);

        const tdOpen = document.createElement('td');
        tdOpen.textContent = `${ch.open_conversations} (ยังไม่อ่าน ${ch.unread_count})`;

        const tdIn = document.createElement('td');
        tdIn.textContent = String(ch.inbound_count);

        const tdOut = document.createElement('td');
        tdOut.textContent = String(ch.outbound_count);

        const tdQuota = document.createElement('td');
        if (ch.platform === 'line') {
          const pct = Math.min(100, Math.round((ch.line_reply_month / (ch.line_reply_quota || 25000)) * 100));
          const wrap = document.createElement('div');
          wrap.className = 'quota-bar-wrap';
          const track = document.createElement('div');
          track.className = 'quota-bar-track';
          const fill = document.createElement('div');
          fill.className = `quota-bar-fill${pct >= 90 ? ' danger' : pct >= 70 ? ' warn' : ''}`;
          fill.style.width = `${pct}%`;
          track.append(fill);
          const lbl = document.createElement('div');
          lbl.className = 'quota-bar-label';
          lbl.textContent = `${ch.line_reply_month.toLocaleString()} / ${(ch.line_reply_quota || 25000).toLocaleString()} (${pct}%)`;
          wrap.append(track, lbl);
          tdQuota.append(wrap);
        } else {
          tdQuota.textContent = 'ไม่จำกัด (FB 24h)';
          tdQuota.style.color = '#64748b';
        }

        const tdPush = document.createElement('td');
        tdPush.textContent = ch.platform === 'line'
          ? `Push ${ch.line_push_month.toLocaleString()}`
          : `FB ส่งออก ${ch.fb_outbound_month.toLocaleString()}`;

        tr.append(tdName, tdOpen, tdIn, tdOut, tdQuota, tdPush);
        return tr;
      })
    );
  }

  // Agents KPI table
  const agList = data.agents || [];
  els.dashAgentsBody.replaceChildren(
    ...agList.map((ag) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = ag.display_name;
      const tdRole = document.createElement('td');
      tdRole.textContent = ag.role.toUpperCase();
      const tdSent = document.createElement('td');
      tdSent.textContent = String(ag.messages_sent);
      const tdRes = document.createElement('td');
      tdRes.textContent = String(ag.resolved_conversations);
      const tdSla = document.createElement('td');
      tdSla.textContent = ag.avg_response_minutes != null ? `${ag.avg_response_minutes} นาที` : '-';
      const tdLogin = document.createElement('td');
      tdLogin.textContent = ag.last_login_at ? formatTime(ag.last_login_at) : '-';
      tr.append(tdName, tdRole, tdSent, tdRes, tdSla, tdLogin);
      return tr;
    })
  );

  // Vouchers & Anti-Fraud Summary
  els.dashVoucherStats.replaceChildren(
    (() => {
      const b = document.createElement('div');
      b.className = 'stat-box ok';
      b.innerHTML = `<span>🎁 โค้ดพร้อมแจก / ทั้งหมด</span><strong>${v.availableVouchers ?? 0} / ${v.totalVouchers ?? 0}</strong>`;
      return b;
    })(),
    (() => {
      const b = document.createElement('div');
      b.className = 'stat-box used';
      b.innerHTML = `<span>✅ แจกแล้ว (1/1) · ตรวจผ่าน AI</span><strong>${v.claimedVouchers ?? 0} (ผ่าน ${v.aiPassCount ?? 0})</strong>`;
      return b;
    })(),
    (() => {
      const b = document.createElement('div');
      b.className = 'stat-box';
      b.innerHTML = `<span>🛡 บล็อก Fraud / รูปซ้ำได้</span><strong style="color:#dc2626;">${v.fraudBlockedCount ?? 0} เคส</strong>`;
      return b;
    })()
  );
}

async function loadSaasAdminOverview() {
  try {
    const data = await api('/api/admin/overview');
    state.workspaces = data.workspaces || [];
    renderWorkspaceHeader();
    renderSaasAdminOverview(data);
  } catch (err) {
    showToast(`โหลดแผงควบคุม SaaS ไม่สำเร็จ: ${err.message}`);
  }
}

function showSaasCredentialsBanner({ workspaceName, email, tempPassword, isReset = false }) {
  const loginUrl = state.publicBaseUrl || window.location.origin;
  els.saasCredsTitle.textContent = isReset
    ? `🔑 รีเซ็ตรหัส Owner สำเร็จ (${workspaceName}) — รหัสใช้ครั้งเดียว บังคับเปลี่ยนทันทีตอน Login`
    : `🎉 สร้างองค์กร "${workspaceName}" สำเร็จ — ส่งข้อมูลด้านล่างให้ลูกค้า (บังคับเปลี่ยนรหัสครั้งแรก)`;
  els.saasCredsText.textContent =
    `ลิงก์เข้าสู่ระบบ DmCare: ${loginUrl}\nอีเมล (Owner): ${email}\nรหัสผ่านชั่วคราว (ใช้ครั้งเดียว): ${tempPassword}\n*ระบบจะบังคับให้ตั้งรหัสผ่านส่วนตัวใหม่ทันทีเมื่อเข้าสู่ระบบครั้งแรก`;
  els.saasCredsBanner.classList.remove('hidden');
}

function openWorkspaceEditor(ws) {
  state.editingWorkspaceId = ws.id;
  els.newWorkspaceForm.classList.add('hidden');
  els.editWorkspaceForm.classList.remove('hidden');
  els.editWsHeading.textContent = `แก้ไขแพ็กเกจ: ${ws.name}`;
  els.editWsName.value = ws.name;
  els.editWsPlan.value = ws.plan_code || 'starter';
  els.editWsExpires.value = ws.expires_at ? String(ws.expires_at).slice(0, 10) : '';
  els.editWsMaxChannels.value = String(ws.max_channels ?? 5);
  els.editWsMaxAgents.value = String(ws.max_agents ?? 5);
  els.editWsAiEnabled.checked = Boolean(ws.ai_enabled);
  els.editWsContactNotes.value = ws.contact_notes || '';
}

function renderSaasAdminOverview(data) {
  const s = data.summary || {};
  els.saasKpiGrid.replaceChildren(
    makeKpiCard('องค์กรลูกค้า (Active)', `${s.activeWorkspaces ?? 0} / ${s.totalWorkspaces ?? 0}`, `ใกล้หมดอายุ 7 วัน: ${s.expiringSoonWorkspaces ?? 0}`, 'purple'),
    makeKpiCard('ร้านค้าทั้งหมด', s.totalChannels ?? 0, `แอดมินรวม ${s.totalAgents ?? 0} คน`, 'blue'),
    makeKpiCard('ข้อความรวมเดือนนี้', (s.messagesThisMonth ?? 0).toLocaleString(), 'เทียบความจุ Server 500K/เดือน', 'green'),
    makeKpiCard('เรียก Gemini AI เดือนนี้', (s.aiChecksThisMonth ?? 0).toLocaleString(), 'คุมต้นทุน AI API รวม', 'amber')
  );

  const nodes = (data.workspaces || []).map((ws) => {
    const row = document.createElement('div');
    row.className = 'qr-manage-item';

    const info = document.createElement('div');
    info.className = 'qr-manage-info';

    const head = document.createElement('div');
    head.className = 'qr-manage-head';
    const nameEl = document.createElement('strong');
    nameEl.textContent = ws.name;
    const planTag = document.createElement('span');
    planTag.className = `plan-badge ${ws.plan_code || 'starter'}`;
    planTag.textContent = (ws.plan_code || 'starter').toUpperCase();
    const aiTag = document.createElement('span');
    aiTag.className = `vch-status ${ws.ai_enabled ? 'available' : 'claimed'}`;
    aiTag.textContent = ws.ai_enabled ? '🤖 AI Pro: ON' : '🔒 AI: OFF';
    const stTag = document.createElement('span');
    stTag.className = `vch-status ${ws.is_active && !ws.is_expired ? 'available' : 'claimed'}`;
    stTag.textContent = !ws.is_active ? 'ระงับแล้ว' : ws.is_expired ? 'หมดอายุ' : 'ใช้งานปกติ';
    head.append(nameEl, planTag, aiTag, stTag);

    const sub = document.createElement('div');
    sub.className = 'qr-manage-text';
    const expText = ws.expires_at ? ` · หมดอายุ ${String(ws.expires_at).slice(0, 10)}` : ' · ไม่จำกัดวัน';
    sub.textContent = `Owner: ${ws.owner_name} (${ws.owner_email}) · ร้าน ${ws.channel_count}/${ws.max_channels} · แอดมิน ${ws.agent_count}/${ws.max_agents} · ข้อความเดือนนี้ ${ws.messages_this_month.toLocaleString()}${expText}`;

    info.append(head, sub);

    if (ws.contact_notes) {
      const contactLine = document.createElement('div');
      contactLine.className = 'ws-contact-line';
      contactLine.textContent = `📞 ติดต่อ/บิล: ${ws.contact_notes}`;
      info.append(contactLine);
    }

    const actions = document.createElement('div');
    actions.className = 'ws-actions-wrap';

    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'btn btn-dashboard compact';
    switchBtn.textContent = ws.id === state.workspace?.id ? 'กำลังดูอยู่' : '👁 เข้าดู';
    switchBtn.disabled = ws.id === state.workspace?.id;
    switchBtn.addEventListener('click', async () => {
      await switchActiveWorkspace(ws.id);
      els.saasAdminDialog.close();
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary compact';
    editBtn.textContent = 'แก้แพ็กเกจ';
    editBtn.addEventListener('click', () => openWorkspaceEditor(ws));

    actions.append(switchBtn, editBtn);

    if (ws.id !== 'ws_default') {
      const renew30Btn = document.createElement('button');
      renew30Btn.type = 'button';
      renew30Btn.className = 'btn btn-voucher compact';
      renew30Btn.textContent = '+30 วัน';
      renew30Btn.title = 'ต่ออายุแพ็กเกจเพิ่ม 30 วัน';
      renew30Btn.addEventListener('click', async () => {
        try {
          await api(`/api/admin/workspaces/${ws.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ extendDays: 30 }),
          });
          await loadSaasAdminOverview();
          showToast(`ต่ออายุ "${ws.name}" เพิ่ม 30 วันเรียบร้อย`);
        } catch (err) {
          showToast(err.message);
        }
      });

      const renew365Btn = document.createElement('button');
      renew365Btn.type = 'button';
      renew365Btn.className = 'btn btn-voucher compact';
      renew365Btn.textContent = '+1 ปี';
      renew365Btn.title = 'ต่ออายุแพ็กเกจเพิ่ม 365 วัน';
      renew365Btn.addEventListener('click', async () => {
        try {
          await api(`/api/admin/workspaces/${ws.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ extendDays: 365 }),
          });
          await loadSaasAdminOverview();
          showToast(`ต่ออายุ "${ws.name}" เพิ่ม 1 ปีเรียบร้อย`);
        } catch (err) {
          showToast(err.message);
        }
      });

      const resetPwBtn = document.createElement('button');
      resetPwBtn.type = 'button';
      resetPwBtn.className = 'btn btn-secondary compact';
      resetPwBtn.textContent = '🔑 รีเซ็ตรหัส';
      resetPwBtn.title = 'ออกรหัสผ่านชั่วคราวแบบใช้ครั้งเดียวให้ Owner (บังคับเปลี่ยนตอน Login)';
      resetPwBtn.addEventListener('click', async () => {
        if (!window.confirm(`ออกรหัสผ่านชั่วคราวใหม่ให้ Owner (${ws.owner_email}) ของ "${ws.name}" หรือไม่?\nรหัสเดิมจะใช้งานไม่ได้ทันที และระบบจะบังคับให้ลูกค้าตั้งรหัสใหม่เมื่อ Login`)) {
          return;
        }
        try {
          const res = await api(`/api/admin/workspaces/${ws.id}/reset-owner-password`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          showSaasCredentialsBanner({
            workspaceName: ws.name,
            email: res.ownerEmail,
            tempPassword: res.tempPassword,
            isReset: true,
          });
          showToast(`รีเซ็ตรหัสผ่านของ ${res.ownerEmail} เรียบร้อย`);
        } catch (err) {
          showToast(`รีเซ็ตรหัสไม่สำเร็จ: ${err.message}`);
        }
      });

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = ws.is_active ? 'btn btn-danger compact' : 'btn btn-voucher compact';
      toggleBtn.textContent = ws.is_active ? 'ระงับ' : 'เปิดใช้';
      toggleBtn.addEventListener('click', async () => {
        try {
          await api(`/api/admin/workspaces/${ws.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive: !ws.is_active }),
          });
          await loadSaasAdminOverview();
          showToast(ws.is_active ? `ระงับองค์กร "${ws.name}" แล้ว` : `เปิดใช้งานองค์กร "${ws.name}" แล้ว`);
        } catch (err) {
          showToast(err.message);
        }
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger compact';
      delBtn.textContent = '🗑 ลบ';
      delBtn.title = 'ลบองค์กรลูกค้านี้ออกจากระบบถาวร (ยืนยัน 2 ชั้น)';
      delBtn.addEventListener('click', async () => {
        const typed = window.prompt(
          `⚠️ คำเตือน: การลบองค์กร "${ws.name}" จะลบร้านค้า (${ws.channel_count}), แอดมิน (${ws.agent_count}), และแชททั้งหมดถาวร!\n\nพิมพ์ชื่อองค์กรให้ตรงเป๊ะเพื่อยืนยัน: ${ws.name}`
        );
        if (typed === null) return;
        if (typed.trim() !== ws.name) {
          showToast('ชื่อองค์กรไม่ตรงกัน ยกเลิกการลบแล้ว');
          return;
        }
        try {
          await api(`/api/admin/workspaces/${ws.id}`, {
            method: 'DELETE',
            body: JSON.stringify({ confirmName: typed.trim() }),
          });
          if (state.workspace?.id === ws.id) {
            await switchActiveWorkspace('ws_default');
          }
          await loadSaasAdminOverview();
          showToast(`ลบองค์กร "${ws.name}" ออกจากระบบเรียบร้อยแล้ว`);
        } catch (err) {
          showToast(`ลบไม่สำเร็จ: ${err.message}`);
        }
      });

      actions.append(renew30Btn, renew365Btn, resetPwBtn, toggleBtn, delBtn);
    }

    row.append(info, actions);
    return row;
  });

  els.saasWorkspacesList.replaceChildren(...nodes);
}

async function switchActiveWorkspace(targetWorkspaceId) {
  try {
    await api('/api/admin/switch-workspace', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: targetWorkspaceId }),
    });
    await startAuthenticatedSession(state.currentUser);
    showToast(`สลับมาที่องค์กร "${state.workspace?.name || targetWorkspaceId}" แล้ว`);
  } catch (err) {
    showToast(`สลับองค์กรไม่สำเร็จ: ${err.message}`);
  }
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

    // Live collision viewer / typing pill if another admin is in this chat
    const viewers = getOtherViewers(conv.id);
    if (viewers.length > 0) {
      const typingViewers = viewers.filter((v) => v.isTyping);
      const vp = document.createElement('span');
      if (typingViewers.length > 0) {
        const names = [...new Set(typingViewers.map((v) => v.agentName))];
        vp.className = 'viewer-pill typing';
        vp.textContent =
          names.length > 1
            ? `✍️ ${names[0]} +${names.length - 1} กำลังพิมพ์...`
            : `✍️ ${names[0]} กำลังพิมพ์...`;
      } else {
        const names = [...new Set(viewers.map((v) => v.agentName))];
        vp.className = 'viewer-pill';
        vp.textContent = names.length > 1 ? `👁 ${names[0]} +${names.length - 1}` : `👁 ${names[0]}`;
      }
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
    if (els.typingIndicatorBar) els.typingIndicatorBar.classList.add('hidden');
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

  const isReplied = Boolean(conv.is_replied);
  els.markRepliedBtn.classList.toggle('replied', isReplied);
  els.markRepliedBtn.textContent = isReplied ? '↩ ย้ายกลับรอตอบ' : '✓ ไม่ต้องตอบ';
  els.markRepliedBtn.title = isReplied
    ? 'คลิกเพื่อย้ายแชทนี้กลับไปที่กล่อง "รอตอบ"'
    : 'คลิกเพื่อเปลี่ยนเป็นอ่านแล้ว/ไม่ต้องตอบ (นำออกจากกล่อง "รอตอบ" โดยไม่ส่งข้อความหาลูกค้า)';

  const isPending = conv.status === 'pending';
  els.escalateBtn.classList.toggle('active', isPending);
  els.escalateBtn.textContent = isPending ? '🚩 อยู่ในต้องดำเนินการ (นำออก)' : '🚩 ต้องดำเนินการ';
  els.escalateBtn.title = isPending
    ? 'คลิกเพื่อนำแชทนี้ออกจากโฟลเดอร์ "ต้องดำเนินการ" กลับไปสถานะเปิดอยู่'
    : 'คลิกเพื่อย้ายแชทนี้ไปโฟลเดอร์ "ต้องดำเนินการ"';

  renderCollisionBanner();
  renderQuickReplies();

  // Find index of the latest customer message to display admin read-status cleanly
  let lastCustomerMsgIdx = -1;
  state.activeMessages.forEach((m, idx) => {
    if (m.sender_type === 'customer') lastCustomerMsgIdx = idx;
  });

  // Render messages (images render directly without a colored chat bubble behind them)
  const msgNodes = state.activeMessages.map((m, idx) => {
    const row = document.createElement('div');
    row.className = `msg-row ${m.sender_type === 'customer' ? 'customer' : 'agent'}`;

    if (m.media_url) {
      const img = document.createElement('img');
      const isStickerMsg = m.message_type === 'sticker';
      img.className = isStickerMsg ? 'msg-sticker' : 'msg-image';
      img.src = m.media_url;
      img.alt = m.content_text || (isStickerMsg ? 'สติกเกอร์' : 'รูปภาพในแชท');
      img.loading = 'lazy';
      if (!isStickerMsg) {
        img.addEventListener('click', () => openLightbox(m.media_url));
      }
      row.append(img);
    }

    if (m.content_text && !(m.message_type === 'sticker' && m.media_url)) {
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
      meta.title = `ช่องทางส่ง: ${m.delivery_method}`;
    }

    // Read receipt indicator on outbound agent messages
    if (m.sender_type === 'agent') {
      const readTag = document.createElement('span');
      if (m.delivery_status === 'read') {
        readTag.className = 'read-badge read';
        readTag.textContent = '✓✓ อ่านแล้ว';
        readTag.title = 'ลูกค้าเปิดอ่านข้อความนี้แล้ว';
      } else {
        readTag.className = 'read-badge sent';
        readTag.textContent = '✓ ส่งแล้ว';
        readTag.title = conv.platform === 'line'
          ? 'ส่งถึงลูกค้าแล้ว (LINE API ไม่ส่งสัญญาณตอนลูกค้าเปิดอ่าน จะเปลี่ยนเป็น "อ่านแล้ว" เมื่อลูกค้าตอบกลับ)'
          : 'ส่งถึงลูกค้าแล้ว (รอยืนยันการเปิดอ่านจาก Facebook)';
      }
      meta.append(readTag);
    } else if (idx === lastCustomerMsgIdx) {
      // Admin read indicator on latest customer message
      const adminReadTag = document.createElement('span');
      if (Number(conv.unread_count || 0) > 0) {
        adminReadTag.className = 'read-badge unread';
        adminReadTag.textContent = '● ยังไม่อ่าน';
      } else {
        adminReadTag.className = 'read-badge admin-read';
        adminReadTag.textContent = conv.last_read_by_agent_name
          ? `👁 อ่านแล้ว (${conv.last_read_by_agent_name}${conv.last_read_at ? ` · ${formatTime(conv.last_read_at)}` : ''})`
          : '👁 เปิดอ่านแล้ว';
      }
      meta.append(adminReadTag);
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
  els.infoCustomerName.textContent = conv.customer_name;
  if (
    els.editCustomerNameForm &&
    !els.editCustomerNameForm.classList.contains('hidden') &&
    els.editCustomerNameForm.dataset.convId !== conv.id
  ) {
    els.editCustomerNameForm.classList.add('hidden');
    els.infoCustomerNameView?.classList.remove('hidden');
  }
  els.infoChannelName.textContent = `${conv.channel_name} (${conv.platform.toUpperCase()} ${conv.shop_code})`;
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

  const aiAllowed = !state.workspace || state.workspace.ai_enabled !== false;
  if (!aiAllowed) {
    els.aiProviderBadge.textContent = '🔒 Pro Add-on';
    els.aiProviderBadge.classList.remove('live');
    els.mockAiScenarioSelect.classList.add('hidden');
  } else {
    els.aiProviderBadge.textContent = state.geminiEnabled ? 'AI พร้อมใช้' : 'AI ทดสอบ';
    els.aiProviderBadge.classList.toggle('live', state.geminiEnabled);
    els.mockAiScenarioSelect.classList.toggle('hidden', state.geminiEnabled);
  }
}

function getCustomerEvidenceImages() {
  return state.activeMessages
    .filter((m) => m.sender_type === 'customer' && m.media_url && m.message_type !== 'sticker')
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

  es.addEventListener('messages:read', async (event) => {
    const payload = JSON.parse(event.data);
    if (payload.conversationId === state.activeConversationId) {
      const data = await api(`/api/conversations/${state.activeConversationId}/messages`);
      state.activeMessages = data.messages;
      renderActiveChat(data.conversation);
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
  // Sidebar collapse toggle (persisted in localStorage)
  const applySidebarCollapsed = (collapsed) => {
    els.appShell.classList.toggle('sidebar-collapsed', collapsed);
    if (els.sidebarToggleBtn) {
      els.sidebarToggleBtn.title = collapsed ? 'กางแถบเมนูซ้าย' : 'ยุบแถบเมนูซ้าย';
      els.sidebarToggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  };
  applySidebarCollapsed(localStorage.getItem('dmcare_sidebar_collapsed') === '1');

  if (els.sidebarToggleBtn) {
    els.sidebarToggleBtn.addEventListener('click', () => {
      const next = !els.appShell.classList.contains('sidebar-collapsed');
      localStorage.setItem('dmcare_sidebar_collapsed', next ? '1' : '0');
      applySidebarCollapsed(next);
    });
  }
  if (els.sidebarBrand) {
    els.sidebarBrand.addEventListener('click', () => {
      if (els.appShell.classList.contains('sidebar-collapsed')) {
        localStorage.setItem('dmcare_sidebar_collapsed', '0');
        applySidebarCollapsed(false);
      }
    });
  }
  if (els.userAvatarBadge) {
    els.userAvatarBadge.parentElement?.addEventListener('click', () => {
      if (els.appShell.classList.contains('sidebar-collapsed')) {
        localStorage.setItem('dmcare_sidebar_collapsed', '0');
        applySidebarCollapsed(false);
      }
    });
  }

  // Platform dropdown accordions (LINE OA & Facebook Pages)
  const setupPlatformDropdown = (btn, listEl, storageKey) => {
    if (!btn || !listEl) return;
    const applyState = (expanded) => {
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      listEl.classList.toggle('collapsed', !expanded);
    };
    const saved = localStorage.getItem(storageKey);
    applyState(saved !== '0');
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-expanded') !== 'true';
      localStorage.setItem(storageKey, next ? '1' : '0');
      applyState(next);
    });
  };
  setupPlatformDropdown(els.toggleLineGroupBtn, els.lineChannelList, 'dmcare_nav_group_line');
  setupPlatformDropdown(els.toggleFbGroupBtn, els.fbChannelList, 'dmcare_nav_group_facebook');

  // Mini-rail quick action delegates (when sidebar is collapsed)
  document.querySelectorAll('.mini-rail-btn[data-filter-platform]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.filter.platform = btn.dataset.filterPlatform;
      state.filter.channelId = 'all';
      syncTopNavActive();
      renderChannels();
      await loadConversations();
    });
  });
  if (els.miniDashboardBtn) els.miniDashboardBtn.addEventListener('click', () => els.openDashboardBtn.click());
  if (els.miniSaasBtn) els.miniSaasBtn.addEventListener('click', () => els.openSaasAdminBtn.click());
  if (els.miniCampaignsBtn) els.miniCampaignsBtn.addEventListener('click', () => els.openCampaignsBtn.click());
  if (els.miniManageChannelsBtn) els.miniManageChannelsBtn.addEventListener('click', () => els.openManageChannelsBtn.click());

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

  // Close active chat via Esc (respecting slash menu, sticker picker & open dialogs first)
  els.closeChatBtn.addEventListener('click', closeActiveConversation);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.stickerPickerPopover.classList.contains('hidden')) {
      e.preventDefault();
      els.stickerPickerPopover.classList.add('hidden');
      return;
    }
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
      els.dashboardDialog.open ||
      els.saasAdminDialog.open ||
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

  let pendingTotpChallenge = null;
  let pendingTotpSetupToken = null;
  let lastGeneratedRecoveryCodes = [];

  const resetLoginTotpStep = () => {
    pendingTotpChallenge = null;
    els.loginTotpForm?.classList.add('hidden');
    els.loginTotpErrorBox?.classList.add('hidden');
    if (els.loginTotpCode) els.loginTotpCode.value = '';
    els.loginForm.classList.remove('hidden');
    if (!state.isProduction) els.loginDemoBox?.classList.remove('hidden');
  };

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
      if (res.requiresTotp && res.challengeToken) {
        pendingTotpChallenge = res.challengeToken;
        els.loginForm.classList.add('hidden');
        els.loginDemoBox?.classList.add('hidden');
        els.loginTotpErrorBox.classList.add('hidden');
        els.loginTotpHint.textContent = `บัญชี ${res.email} เปิดใช้ 2FA — กรอกรหัส 6 หลักจากแอป Authenticator หรือรหัสสำรอง`;
        els.loginTotpForm.classList.remove('hidden');
        els.loginTotpCode.value = '';
        els.loginTotpCode.focus();
        return;
      }
      await startAuthenticatedSession(res.user);
    } catch (err) {
      els.loginErrorBox.textContent = err.message;
      els.loginErrorBox.classList.remove('hidden');
    } finally {
      els.loginSubmitBtn.disabled = false;
      els.loginSubmitBtn.textContent = 'เข้าสู่ระบบ';
    }
  });

  if (els.loginTotpBackBtn) {
    els.loginTotpBackBtn.addEventListener('click', () => {
      resetLoginTotpStep();
      els.loginPassword.focus();
    });
  }

  if (els.loginTotpForm) {
    els.loginTotpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pendingTotpChallenge) {
        resetLoginTotpStep();
        return;
      }
      els.loginTotpErrorBox.classList.add('hidden');
      els.loginTotpSubmitBtn.disabled = true;
      els.loginTotpSubmitBtn.textContent = 'กำลังตรวจสอบรหัส...';
      try {
        const res = await api('/api/auth/verify-2fa', {
          method: 'POST',
          body: JSON.stringify({
            challengeToken: pendingTotpChallenge,
            code: els.loginTotpCode.value.trim(),
          }),
        });
        resetLoginTotpStep();
        await startAuthenticatedSession(res.user);
        if (res.usedRecoveryCode) {
          showToast(`เข้าสู่ระบบด้วยรหัสสำรองสำเร็จ (เหลือรหัสสำรองอีก ${res.remainingRecoveryCodes} ชุด)`);
        }
      } catch (err) {
        els.loginTotpErrorBox.textContent = err.message;
        els.loginTotpErrorBox.classList.remove('hidden');
        els.loginTotpCode.select();
      } finally {
        els.loginTotpSubmitBtn.disabled = false;
        els.loginTotpSubmitBtn.textContent = 'ยืนยันและเข้าสู่ระบบ';
      }
    });
  }

  // Logout
  els.logoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    resetLoginTotpStep();
    showLoginScreen();
    showToast('ออกจากระบบเรียบร้อยแล้ว');
  });

  // Account Security Modal (2FA Authenticator + Change Own Password)
  const renderSecurityModalState = ({ keepRecoveryBox = false } = {}) => {
    const enabled = Boolean(state.currentUser?.totp_enabled);
    if (els.totpStatusPill) {
      els.totpStatusPill.textContent = enabled ? '🟢 เปิดใช้งาน 2FA อยู่แล้ว' : 'ยังไม่เปิดใช้';
      els.totpStatusPill.className = `totp-status-pill ${enabled ? 'on' : 'off'}`;
    }
    els.totpOffPanel?.classList.toggle('hidden', enabled);
    els.totpOnPanel?.classList.toggle('hidden', !enabled);
    els.totpSetupPanel?.classList.add('hidden');
    els.totpDisableForm?.classList.add('hidden');
    if (!keepRecoveryBox) {
      els.totpRecoveryBox?.classList.add('hidden');
      lastGeneratedRecoveryCodes = [];
    }
    pendingTotpSetupToken = null;
  };

  els.openChangePwBtn.addEventListener('click', () => {
    els.changePwForm.reset();
    els.totpEnableForm?.reset();
    els.totpDisableForm?.reset();
    renderSecurityModalState();
    els.changePwDialog.showModal();
  });

  if (els.startTotpSetupBtn) {
    els.startTotpSetupBtn.addEventListener('click', async () => {
      els.startTotpSetupBtn.disabled = true;
      els.startTotpSetupBtn.textContent = 'กำลังสร้าง QR Code...';
      try {
        const res = await api('/api/auth/2fa/setup', { method: 'POST' });
        pendingTotpSetupToken = res.setupToken;
        els.totpQrBox.innerHTML = res.qrSvg;
        els.totpSecretText.textContent = res.formattedSecret || res.secret;
        els.totpSecretText.dataset.rawSecret = res.secret;
        els.totpEnableForm.reset();
        els.totpOffPanel.classList.add('hidden');
        els.totpSetupPanel.classList.remove('hidden');
        els.totpEnablePwInput.focus();
      } catch (err) {
        showToast(`ไม่สามารถเริ่มตั้งค่า 2FA ได้: ${err.message}`);
      } finally {
        els.startTotpSetupBtn.disabled = false;
        els.startTotpSetupBtn.textContent = '🔐 เปิดใช้งาน 2FA (สแกน QR Code)';
      }
    });
  }

  if (els.copyTotpSecretBtn) {
    els.copyTotpSecretBtn.addEventListener('click', async () => {
      const raw = els.totpSecretText.dataset.rawSecret || els.totpSecretText.textContent;
      try {
        await navigator.clipboard.writeText(raw);
        showToast('คัดลอกรหัสตั้งค่า 2FA แล้ว');
      } catch {
        showToast('คัดลอกไม่สำเร็จ กรุณาคลุมดำคัดลอกเอง');
      }
    });
  }

  if (els.cancelTotpSetupBtn) {
    els.cancelTotpSetupBtn.addEventListener('click', () => renderSecurityModalState());
  }

  if (els.totpEnableForm) {
    els.totpEnableForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!pendingTotpSetupToken) {
        showToast('กรุณากดสร้าง QR Code ใหม่อีกครั้ง');
        return;
      }
      try {
        const res = await api('/api/auth/2fa/enable', {
          method: 'POST',
          body: JSON.stringify({
            setupToken: pendingTotpSetupToken,
            currentPassword: els.totpEnablePwInput.value,
            code: els.totpEnableCodeInput.value.trim(),
          }),
        });
        state.currentUser = res.user;
        renderCurrentUserCard();
        lastGeneratedRecoveryCodes = res.recoveryCodes || [];
        els.totpRecoveryGrid.replaceChildren(
          ...lastGeneratedRecoveryCodes.map((code) => {
            const item = document.createElement('div');
            item.className = 'totp-recovery-item';
            item.textContent = code;
            return item;
          })
        );
        renderSecurityModalState({ keepRecoveryBox: true });
        els.totpRecoveryBox.classList.remove('hidden');
        showToast('เปิดใช้งาน 2FA สำเร็จ! กรุณาบันทึกรหัสสำรองไว้ด้วย');
      } catch (err) {
        showToast(`เปิดใช้งาน 2FA ไม่สำเร็จ: ${err.message}`);
      }
    });
  }

  if (els.copyRecoveryCodesBtn) {
    els.copyRecoveryCodesBtn.addEventListener('click', async () => {
      if (!lastGeneratedRecoveryCodes.length) return;
      try {
        await navigator.clipboard.writeText(
          `DmCare 2FA Recovery Codes (${state.currentUser?.email || ''}):\n${lastGeneratedRecoveryCodes.join('\n')}`
        );
        showToast('คัดลอกรหัสสำรองทั้ง 8 ชุดแล้ว');
      } catch {
        showToast('คัดลอกไม่สำเร็จ กรุณาจดหรือแคปหน้าจอเก็บไว้');
      }
    });
  }

  if (els.openDisableTotpBtn) {
    els.openDisableTotpBtn.addEventListener('click', () => {
      els.totpDisableForm.reset();
      els.totpDisableForm.classList.remove('hidden');
      els.totpDisablePwInput.focus();
    });
  }

  if (els.cancelTotpDisableBtn) {
    els.cancelTotpDisableBtn.addEventListener('click', () => {
      els.totpDisableForm.classList.add('hidden');
    });
  }

  if (els.totpDisableForm) {
    els.totpDisableForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api('/api/auth/2fa/disable', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: els.totpDisablePwInput.value,
            code: els.totpDisableCodeInput.value.trim(),
          }),
        });
        state.currentUser = res.user;
        renderCurrentUserCard();
        renderSecurityModalState();
        showToast('ปิดการใช้งาน 2FA เรียบร้อยแล้ว');
      } catch (err) {
        showToast(`ปิด 2FA ไม่สำเร็จ: ${err.message}`);
      }
    });
  }

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

  els.markRepliedBtn.addEventListener('click', async () => {
    if (!state.activeConversation) return;
    const nextReplied = !Boolean(state.activeConversation.is_replied);
    await updateActiveConvMeta({ isReplied: nextReplied });
    showToast(
      nextReplied
        ? 'ทำเครื่องหมาย "อ่านแล้ว / ไม่ต้องตอบ" — ย้ายไปกล่อง "ตอบแล้ว" เรียบร้อย'
        : 'ย้ายแชทกลับไปที่กล่อง "รอตอบ" แล้ว'
    );
  });

  // Sticker picker toggle (auto-selects FB/Emoji tab on Facebook chats and Brown on LINE chats)
  els.openStickerPickerBtn.addEventListener('click', () => {
    if (els.stickerPickerPopover.classList.contains('hidden')) {
      if (state.activeConversation?.platform === 'facebook' && !['fb_emoji', 'custom'].includes(activeStickerPackId)) {
        activeStickerPackId = 'fb_emoji';
      }
      renderStickerPicker();
      els.stickerPickerPopover.classList.remove('hidden');
    } else {
      els.stickerPickerPopover.classList.add('hidden');
    }
  });
  els.closeStickerPickerBtn.addEventListener('click', () => {
    els.stickerPickerPopover.classList.add('hidden');
  });
  els.uploadCustomStickerBtn.addEventListener('click', () => els.customStickerFileInput.click());
  els.customStickerFileInput.addEventListener('change', async () => {
    const file = els.customStickerFileInput.files?.[0];
    els.customStickerFileInput.value = '';
    if (!file) return;
    try {
      showToast('กำลังอัปโหลดสติกเกอร์ของร้าน...');
      const dataUrl = await fileToDataUrl(file);
      const uploaded = await api('/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ dataUrl }),
      });
      const created = await api('/api/stickers', {
        method: 'POST',
        body: JSON.stringify({ label: file.name.replace(/\.[^.]+$/, ''), mediaUrl: uploaded.url }),
      });
      state.customStickers = [created.sticker, ...(state.customStickers || [])];
      activeStickerPackId = 'custom';
      renderStickerPicker();
      showToast('เพิ่มสติกเกอร์ของร้านเรียบร้อยแล้ว!');
    } catch (err) {
      showToast(`อัปโหลดสติกเกอร์ไม่สำเร็จ: ${err.message}`);
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
    if (!state.activeConversationId) return;
    const hasText = els.replyInput.value.trim().length > 0;
    clearTimeout(typingIdleTimer);
    if (!hasText) {
      reportPresence({ conversationId: state.activeConversationId, isTyping: false });
      return;
    }
    reportPresence({ conversationId: state.activeConversationId, isTyping: true });
    typingIdleTimer = setTimeout(() => {
      if (state.activeConversationId) {
        reportPresence({ conversationId: state.activeConversationId, isTyping: false });
      }
    }, 3500);
  });

  els.replyInput.addEventListener('blur', () => {
    clearTimeout(typingIdleTimer);
    if (state.activeConversationId && lastPresenceSent.isTyping) {
      reportPresence({ conversationId: state.activeConversationId, isTyping: false });
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
      showToast('ส่งข้อความสำเร็จ — ย้ายไปกล่อง "ตอบแล้ว"');
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

  // Edit customer display name inline
  const closeCustomerNameEditor = () => {
    els.editCustomerNameForm?.classList.add('hidden');
    els.infoCustomerNameView?.classList.remove('hidden');
  };
  if (els.editCustomerNameBtn) {
    els.editCustomerNameBtn.addEventListener('click', () => {
      if (!state.activeConversation) return;
      els.editCustomerNameForm.dataset.convId = state.activeConversation.id;
      els.editCustomerNameInput.value = state.activeConversation.customer_name || '';
      els.infoCustomerNameView.classList.add('hidden');
      els.editCustomerNameForm.classList.remove('hidden');
      els.editCustomerNameInput.focus();
      els.editCustomerNameInput.select();
    });
  }
  if (els.cancelCustomerNameBtn) {
    els.cancelCustomerNameBtn.addEventListener('click', closeCustomerNameEditor);
  }
  if (els.editCustomerNameInput) {
    els.editCustomerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeCustomerNameEditor();
      }
    });
  }
  if (els.editCustomerNameForm) {
    els.editCustomerNameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = els.editCustomerNameInput.value.trim();
      if (!newName) {
        showToast('กรุณาระบุชื่อลูกค้า');
        return;
      }
      await updateActiveConvMeta({ customerName: newName });
      closeCustomerNameEditor();
      showToast('บันทึกชื่อลูกค้าเรียบร้อย');
    });
  }

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

  // Workspace Dashboard (Tier 1 & Tier 2 Only)
  els.openDashboardBtn.addEventListener('click', async () => {
    els.dashboardDialog.showModal();
    await loadWorkspaceDashboard(els.dashRangeSelect.value || '30d');
  });
  els.dashRangeSelect.addEventListener('change', () => {
    loadWorkspaceDashboard(els.dashRangeSelect.value);
  });

  // Super Admin SaaS Console & Workspace Switcher (Tier 1 Only)
  els.workspaceSwitcher.addEventListener('change', () => {
    if (els.workspaceSwitcher.value && els.workspaceSwitcher.value !== state.workspace?.id) {
      switchActiveWorkspace(els.workspaceSwitcher.value);
    }
  });
  els.openSaasAdminBtn.addEventListener('click', async () => {
    els.newWorkspaceForm.classList.add('hidden');
    els.editWorkspaceForm.classList.add('hidden');
    els.saasAdminDialog.showModal();
    await loadSaasAdminOverview();
  });
  els.toggleNewWsBtn.addEventListener('click', () => {
    els.editWorkspaceForm.classList.add('hidden');
    els.newWorkspaceForm.classList.toggle('hidden');
  });
  els.cancelNewWsBtn.addEventListener('click', () => els.newWorkspaceForm.classList.add('hidden'));
  els.cancelEditWsBtn.addEventListener('click', () => {
    els.editWorkspaceForm.classList.add('hidden');
    state.editingWorkspaceId = null;
  });
  els.wsPlanSelect.addEventListener('change', () => {
    const plan = els.wsPlanSelect.value;
    if (plan === 'starter') {
      els.wsMaxChannelsInput.value = '5';
      els.wsMaxAgentsInput.value = '5';
      els.wsAiEnabledCheck.checked = false;
    } else if (plan === 'pro') {
      els.wsMaxChannelsInput.value = '10';
      els.wsMaxAgentsInput.value = '15';
      els.wsAiEnabledCheck.checked = true;
    } else {
      els.wsMaxChannelsInput.value = '50';
      els.wsMaxAgentsInput.value = '50';
      els.wsAiEnabledCheck.checked = true;
    }
  });
  // Support Mode exit button -> return to DmCare Main
  els.exitSupportModeBtn.addEventListener('click', () => {
    switchActiveWorkspace('ws_default');
  });

  // Copyable 1-time credentials banner buttons
  els.copySaasCredsBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.saasCredsText.textContent);
      showToast('คัดลอกข้อมูลส่งให้ลูกค้าเรียบร้อยแล้ว');
    } catch {
      showToast('กรุณาเลือกข้อความเพื่อคัดลอก');
    }
  });
  els.dismissSaasCredsBtn.addEventListener('click', () => {
    els.saasCredsBanner.classList.add('hidden');
  });

  // Mandatory 1-Time Password Change Form
  els.forcePwLogoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    showLoginScreen();
  });
  els.forcePwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.forcePwErrorBox.classList.add('hidden');
    if (els.forceNewPw.value !== els.forceConfirmPw.value) {
      els.forcePwErrorBox.textContent = 'รหัสผ่านใหม่ทั้ง 2 ช่องไม่ตรงกัน';
      els.forcePwErrorBox.classList.remove('hidden');
      return;
    }
    els.forcePwSubmitBtn.disabled = true;
    try {
      const res = await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: els.forceCurPw.value,
          newPassword: els.forceNewPw.value,
        }),
      });
      els.forcePwForm.reset();
      els.forcePwScreen.classList.add('hidden');
      showToast('ตั้งรหัสผ่านส่วนตัวใหม่เรียบร้อยแล้ว ยินดีต้อนรับสู่ DmCare!');
      await startAuthenticatedSession(res.user || { ...state.currentUser, must_change_password: false });
    } catch (err) {
      els.forcePwErrorBox.textContent = err.message;
      els.forcePwErrorBox.classList.remove('hidden');
    } finally {
      els.forcePwSubmitBtn.disabled = false;
    }
  });

  els.newWorkspaceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const tempPw = els.wsOwnerPasswordInput.value;
      const res = await api('/api/admin/workspaces', {
        method: 'POST',
        body: JSON.stringify({
          name: els.wsNameInput.value.trim(),
          planCode: els.wsPlanSelect.value,
          maxChannels: Number(els.wsMaxChannelsInput.value || 5),
          maxAgents: Number(els.wsMaxAgentsInput.value || 5),
          aiEnabled: els.wsAiEnabledCheck.checked,
          expiresAt: els.wsExpiresInput.value ? `${els.wsExpiresInput.value}T23:59:59.000Z` : null,
          contactNotes: els.wsContactNotesInput.value.trim(),
          ownerName: els.wsOwnerNameInput.value.trim(),
          ownerEmail: els.wsOwnerEmailInput.value.trim(),
          ownerPassword: tempPw,
          mustChangePassword: true,
        }),
      });
      els.newWorkspaceForm.reset();
      els.wsMaxChannelsInput.value = '5';
      els.wsMaxAgentsInput.value = '5';
      els.wsAiEnabledCheck.checked = false;
      els.newWorkspaceForm.classList.add('hidden');
      await loadSaasAdminOverview();
      showSaasCredentialsBanner({
        workspaceName: res.workspace.name,
        email: res.owner.email,
        tempPassword: res.tempPassword || tempPw,
        isReset: false,
      });
      showToast(`สร้างองค์กร "${res.workspace.name}" + ออกรหัสชั่วคราวเรียบร้อย!`);
    } catch (err) {
      showToast(`สร้างองค์กรไม่สำเร็จ: ${err.message}`);
    }
  });
  els.editWorkspaceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.editingWorkspaceId) return;
    try {
      await api(`/api/admin/workspaces/${state.editingWorkspaceId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: els.editWsName.value.trim(),
          planCode: els.editWsPlan.value,
          maxChannels: Number(els.editWsMaxChannels.value || 5),
          maxAgents: Number(els.editWsMaxAgents.value || 5),
          aiEnabled: els.editWsAiEnabled.checked,
          expiresAt: els.editWsExpires.value ? `${els.editWsExpires.value}T23:59:59.000Z` : null,
          contactNotes: els.editWsContactNotes.value.trim(),
        }),
      });
      els.editWorkspaceForm.classList.add('hidden');
      const editedCurrent = state.editingWorkspaceId === state.workspace?.id;
      state.editingWorkspaceId = null;
      await loadSaasAdminOverview();
      if (editedCurrent) {
        const refreshed = state.workspaces.find((w) => w.id === state.workspace?.id);
        if (refreshed) {
          state.workspace = refreshed;
          renderWorkspaceHeader();
        }
      }
      showToast('อัปเดตแพ็กเกจองค์กรเรียบร้อยแล้ว');
    } catch (err) {
      showToast(`อัปเดตไม่สำเร็จ: ${err.message}`);
    }
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

  // Presence heartbeat every 20s so open-chat viewer status never expires (server TTL = 45s)
  setInterval(() => {
    if (state.currentUser && state.activeConversationId && !document.hidden) {
      reportPresence({
        conversationId: state.activeConversationId,
        isTyping: lastPresenceSent.isTyping && document.activeElement === els.replyInput,
        force: true,
      });
    }
  }, 20_000);
}

function showLoginScreen(errorMsg = '') {
  disconnectSse();
  lastPresenceSent = { conversationId: null, isTyping: false, at: 0 };
  state.currentUser = null;
  state.activeConversationId = null;
  state.activeConversation = null;
  state.activeMessages = [];
  state.conversations = [];
  els.appShell.classList.add('hidden');
  els.forcePwScreen.classList.add('hidden');
  els.loginScreen.classList.remove('hidden');
  document.title = BASE_TITLE;
  if (errorMsg) {
    els.loginErrorBox.textContent = errorMsg;
    els.loginErrorBox.classList.remove('hidden');
  } else {
    els.loginErrorBox.classList.add('hidden');
  }
}

function showForcePasswordScreen(user) {
  disconnectSse();
  state.currentUser = user;
  els.loginScreen.classList.add('hidden');
  els.appShell.classList.add('hidden');
  els.forcePwErrorBox.classList.add('hidden');
  els.forcePwForm.reset();
  els.forcePwSubtitle.textContent = `บัญชี ${user.email} ใช้รหัสผ่านชั่วคราวแบบใช้ครั้งเดียว กรุณาตั้งรหัสผ่านส่วนตัวใหม่ก่อนเข้าใช้งาน`;
  els.forcePwScreen.classList.remove('hidden');
}

async function startAuthenticatedSession(user) {
  if (user?.must_change_password) {
    showForcePasswordScreen(user);
    return;
  }
  state.currentUser = user;
  state.currentAgentId = user.id;
  state.filter.platform = 'all';
  state.filter.channelId = 'all';
  state.filter.box = 'unreplied';
  state.activeConversationId = null;
  state.activeConversation = null;
  state.activeMessages = [];

  els.loginScreen.classList.add('hidden');
  els.forcePwScreen.classList.add('hidden');
  els.appShell.classList.remove('hidden');

  const boot = await api('/api/bootstrap');
  state.currentUser = boot.user || user;
  state.currentAgentId = state.currentUser.id;
  state.workspace = boot.workspace || null;
  state.workspaces = boot.workspaces || [];
  state.brandName = boot.brandName || 'DmCare';
  state.isProduction = Boolean(boot.isProduction);
  state.dbEngine = boot.dbEngine || 'sqlite';
  state.storageProvider = boot.storageProvider || 'local-disk';
  state.channels = boot.channels;
  state.agents = boot.agents;
  state.quickReplies = boot.quickReplies;
  state.customStickers = boot.customStickers || [];
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
