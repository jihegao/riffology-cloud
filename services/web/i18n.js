const supported = ['zh-CN', 'en'];

export const dictionary = Object.freeze({
  'zh-CN': Object.freeze({
    'shell.skip': '跳到主要内容',
    'shell.home': 'Riffology Cloud 首页',
    'shell.language': '语言',
    'shell.signOut': '退出',
    'shell.signIn': '使用 Google 登录',
    'home.loginEyebrow': 'PRIVATE WORKSPACE',
    'home.loginTitle': '进入你的创作空间',
    'home.loginCopy': '使用受邀请的 Google 账号登录，开始一个新的项目。',
    'home.projectsEyebrow': 'PROJECTS',
    'home.projectsTitle': '你的项目',
    'home.personalWorkspace': '个人空间',
    'home.newProject': '新建项目',
    'admin.loginTitle': '管理员登录',
    'admin.loginCopy': '使用拥有平台管理权限的 Google 账号登录。',
    'admin.signIn': '使用 Google 登录',
    'locale.saveFailed': '语言已在此页面切换，但暂时无法保存到账号。',
    'composer.send': '发送',
    'composer.processing': '正在处理…',
    'composer.confirming': '正在确认上次请求…',
    'composer.retry': '重试上次请求',
    'composer.stale': '旧对话不可继续',
    'composer.processingStatus': '正在提交请求。',
    'composer.awaitingStatus': '请求已接收，正在等待消息显示。',
    'composer.confirmingStatus': '正在确认上次请求。',
    'composer.awaitingRefreshError': '请求已接收，但暂时无法刷新消息；不会重复提交。',
    'composer.refreshFailed': '请求已接收，但多次刷新仍未显示；请稍后刷新此工作区，勿重复提交。',
    'composer.invalidResponse': '请求已接收，但服务端未返回可确认的回合标识；正在保留原请求供确认。',
    'composer.receiptAccepted': '上次请求已由服务端接收，编辑框已恢复。',
    'verifyHandoff.title': 'Verify 实验确认',
    'verifyHandoff.empty': '从 Preview 选择 Verify 后，会在这里确认固定的实验输入。',
    'verifyHandoff.ready': '固定输入尚未提交。',
    'verifyHandoff.frozen': '固定版本 {revisionId} · 包 {packageIdentity} · Seed {seed} · 参数 {parameters}',
    'verifyHandoff.boundary': '本地预览仍未核验。只有确认提交才会请求服务器实验。',
    'verifyHandoff.submit': '确认提交服务器实验',
    'verifyHandoff.submitting': '正在提交原验证请求…',
    'verifyHandoff.disabled': '云端实验当前已暂停，不能提交。',
    'verifyHandoff.created': '已从 Preview 带入固定输入；尚未提交。',
    'verifyHandoff.pending': '原验证请求尚待确认；会保留原身份。',
    'verifyHandoff.previewAction': '带入 Runs 确认',
    'verifyHandoff.previewCreated': '已带入 Runs；尚未提交服务器实验。',
    'verifyHandoff.previewDisabled': '云端实验已暂停；本地预览仍可独立运行。Verify 不会自动提交。',
    'verifyHandoff.recovered': '原验证请求已被服务器接收；恢复没有创建新实验。',
    'verifyHandoff.accepted': '已提交独立服务器实验；本地指标不会成为验证结果。',
    'verifyHandoff.unconfirmed': '原验证回执尚未确认；可在此使用同一请求重试。',
    'verifyHandoff.storageFailed': '无法保存 Verify 输入，请检查浏览器存储后重试。',
    'composer.receiptStorageFailure': '上次请求已由服务端接收，但浏览器未能保存恢复记录；当前页面会继续等待显示，请勿重复提交。',
  }),
  en: Object.freeze({
    'shell.skip': 'Skip to main content',
    'shell.home': 'Riffology Cloud home',
    'shell.language': 'Language',
    'shell.signOut': 'Sign out',
    'shell.signIn': 'Sign in with Google',
    'home.loginEyebrow': 'PRIVATE WORKSPACE',
    'home.loginTitle': 'Enter your workspace',
    'home.loginCopy': 'Sign in with your invited Google account to start a project.',
    'home.projectsEyebrow': 'PROJECTS',
    'home.projectsTitle': 'Your projects',
    'home.personalWorkspace': 'Personal workspace',
    'home.newProject': 'New project',
    'admin.loginTitle': 'Administrator sign in',
    'admin.loginCopy': 'Sign in with a Google account that has platform administration access.',
    'admin.signIn': 'Sign in with Google',
    'locale.saveFailed': 'The language changed on this page, but could not be saved to your account.',
    'composer.send': 'Send',
    'composer.processing': 'Processing…',
    'composer.confirming': 'Confirming previous request…',
    'composer.retry': 'Retry previous request',
    'composer.stale': 'Previous conversation cannot continue',
    'composer.processingStatus': 'Submitting request.',
    'composer.awaitingStatus': 'The request was accepted and is waiting to appear in the conversation.',
    'composer.confirmingStatus': 'Confirming previous request.',
    'composer.awaitingRefreshError': 'The request was accepted, but the conversation could not be refreshed. It will not be submitted again.',
    'composer.refreshFailed': 'The request was accepted but still has not appeared after several refreshes. Refresh this Workspace later; do not submit it again.',
    'composer.invalidResponse': 'The request was accepted, but the server did not return a verifiable Turn identifier. The original request is being retained for confirmation.',
    'composer.receiptAccepted': 'The previous request was accepted by the server and the editor is available again.',
    'verifyHandoff.title': 'Verify experiment confirmation',
    'verifyHandoff.empty': 'Choose Verify in Preview to confirm frozen experiment inputs here.',
    'verifyHandoff.ready': 'Frozen inputs have not been submitted.',
    'verifyHandoff.frozen': 'Frozen revision {revisionId} · package {packageIdentity} · seed {seed} · parameters {parameters}',
    'verifyHandoff.boundary': 'The local preview remains unverified. Only confirmation requests a server experiment.',
    'verifyHandoff.submit': 'Confirm server experiment',
    'verifyHandoff.submitting': 'Submitting the original verification request…',
    'verifyHandoff.disabled': 'Server experiments are currently paused and cannot be submitted.',
    'verifyHandoff.created': 'Frozen inputs were brought from Preview and have not been submitted.',
    'verifyHandoff.pending': 'The original verification request is still pending confirmation and retains its identity.',
    'verifyHandoff.previewAction': 'Continue to Runs for confirmation',
    'verifyHandoff.previewCreated': 'Inputs were brought to Runs; no server experiment was submitted.',
    'verifyHandoff.previewDisabled': 'Server experiments are paused; the local preview remains independent. Verify does not submit automatically.',
    'verifyHandoff.recovered': 'The server accepted the original verification request; recovery created no new experiment.',
    'verifyHandoff.accepted': 'The independent server experiment was submitted; local metrics are not verification results.',
    'verifyHandoff.unconfirmed': 'The original verification receipt is unconfirmed; retry the same request here.',
    'verifyHandoff.storageFailed': 'Could not save Verify inputs. Check browser storage and try again.',
    'composer.receiptStorageFailure': 'The previous request was accepted, but this browser could not save its recovery record. This page will continue waiting for it to appear; do not submit it again.',
  }),
});

function storage() {
  try { return globalThis.window?.localStorage ?? null; }
  catch { return null; }
}

function detect() {
  let saved = null;
  try { saved = storage()?.getItem('riffology:locale') ?? null; }
  catch {}
  if (supported.includes(saved)) return saved;
  return globalThis.navigator?.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

let current = detect();
const listeners = new Set();

export function getLocale() { return current; }

export function t(key, vars = {}, fallback = '') {
  const value = dictionary[current]?.[key]
    ?? dictionary['zh-CN']?.[key]
    ?? dictionary.en?.[key]
    ?? fallback
    ?? '';
  return String(value).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name) => (
    Object.hasOwn(vars, name) ? String(vars[name]) : `{${name}}`
  ));
}

export function setLocale(value, {persist = true} = {}) {
  const next = supported.includes(value) ? value : 'zh-CN';
  if (persist) {
    try { storage()?.setItem('riffology:locale', next); }
    catch {}
  }
  if (next === current) return current;
  current = next;
  for (const listener of listeners) listener(current);
  return current;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat(current, options).format(value);
}

export function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat(current, options).format(value);
}

export function applyTranslations(root = globalThis.document) {
  root?.documentElement?.setAttribute('lang', current);
  for (const node of root?.querySelectorAll?.('[data-i18n]') ?? []) {
    node.textContent = t(node.dataset.i18n, {}, node.dataset.i18nFallback || '');
  }
  for (const node of root?.querySelectorAll?.('[data-i18n-aria-label]') ?? []) {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel, {}, node.getAttribute('aria-label') || ''));
  }
  for (const select of root?.querySelectorAll?.('[data-locale-select]') ?? []) select.value = current;
}

export function installLocaleSelector({root = globalThis.document, onChange = () => {}} = {}) {
  applyTranslations(root);
  const select = root?.querySelector?.('[data-locale-select]');
  if (!select) return () => {};
  const change = () => {
    const next = setLocale(select.value);
    applyTranslations(root);
    onChange(next);
  };
  select.addEventListener('change', change);
  return () => select.removeEventListener('change', change);
}

export const locales = Object.freeze([...supported]);
