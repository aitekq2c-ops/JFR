const $ = (selector) => document.querySelector(selector);
const AUTH_API_URL = 'https://n8n.srv1864214.hstgr.cloud/webhook/c4cf5821-bd91-43cd-a81f-991a8da828cc/jfr-call-report-auth';
const BOOTSTRAP_API_URL = 'https://n8n.srv1864214.hstgr.cloud/webhook/f77da606-21b7-4825-9738-8973b491988e/jfr-call-report-bootstrap';
const INIT_API_URL = 'https://n8n.srv1864214.hstgr.cloud/webhook/84fb43d3-c711-412a-a3a1-bbb8cd1c7d60/jfr-call-report-init';
const REPORTS_API_URL = 'https://n8n.srv1864214.hstgr.cloud/webhook/d027b2b5-d191-451a-a49b-a39cf371c4c5/jfr-call-reports';

let sessionToken = '';
let currentUser = null;
let status = 'ALL';
let loading = false;

const dateInKolkata = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
});
const today = dateInKolkata.format(new Date());
$('#from').value = today;
$('#to').value = today;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function setMessage(element, message) {
  element.textContent = message || '';
  element.hidden = !message;
}

function authHeaders(token = sessionToken) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

async function readJson(response) {
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { throw new Error('The reports service returned an unexpected response. Check the n8n webhook URL and response format.'); }
  if (!response.ok) throw new Error(body.error || 'Request failed (' + response.status + ').');
  return body;
}

async function postAuth(action, payload = {}, token = sessionToken) {
  const response = await fetch(AUTH_API_URL, {
    method: 'POST', headers: authHeaders(token), cache: 'no-store',
    body: JSON.stringify({ action, ...payload })
  });
  return readJson(response);
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function showAuthenticatedView(user) {
  currentUser = user;
  $('#auth-view').hidden = true;
  $('#reports-view').hidden = false;
  $('#account-chip').textContent = user.name + ' · ' + user.role.replace('_', ' ');
  $('#manage-users').hidden = !['admin', 'super_admin'].includes(user.role);
  $('#new-role').innerHTML = (user.role === 'super_admin' ? ['user', 'admin', 'super_admin'] : ['user', 'admin'])
    .map((role) => '<option value="' + role + '">' + role.replace('_', ' ') + '</option>').join('');
  loadCalls();
}

function showLogin() {
  sessionToken = '';
  currentUser = null;
  $('#auth-view').hidden = false;
  $('#reports-view').hidden = true;
  $('#users-view').hidden = true;
  $('#login-password').value = '';
  $('#bootstrap-password').value = '';
  $('#bootstrap-new-password').value = '';
}

async function checkBootstrap() {
  try {
    const result = await postAuth('bootstrap_status', {}, '');
    $('#bootstrap-panel').hidden = !result.needsBootstrap;
    $('#signin-panel').hidden = !!result.needsBootstrap;
  } catch (error) {
    $('#bootstrap-panel').hidden = false;
    $('#signin-panel').hidden = true;
    $('#bootstrap-setup-status').textContent = 'Access setup is not initialized yet. Use the existing reports sign-in below to prepare the PostgreSQL access tables.';
    setMessage($('#bootstrap-error'), /unexpected response/i.test(error.message)
      ? 'First-time access setup is required. Enter the existing reports sign-in and prepare the database below.'
      : (error.message || 'Unable to connect to the sign-in service.'));
  }
}

$('#initialize-access').addEventListener('click', async () => {
  const button = $('#initialize-access');
  const username = $('#bootstrap-username').value.trim();
  const password = $('#bootstrap-password').value;
  if (!username || !password) {
    setMessage($('#bootstrap-error'), 'Enter the existing reports username and password first.');
    return;
  }
  setMessage($('#bootstrap-error'), '');
  setBusy(button, true, 'Preparing…');
  let initialized = false;
  try {
    const headers = authHeaders('');
    const bytes = new TextEncoder().encode(username + ':' + password);
    headers.Authorization = 'Basic ' + btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    const response = await fetch(INIT_API_URL, { method: 'POST', headers, cache: 'no-store', body: '{}' });
    await readJson(response);
    $('#bootstrap-setup-status').textContent = 'PostgreSQL access tables are ready. Create the first super admin below.';
    initialized = true;
    setMessage($('#bootstrap-error'), '');
  } catch (error) {
    setMessage($('#bootstrap-error'), error.message || 'Could not initialize the access tables.');
  } finally {
    if (initialized) {
      button.textContent = 'Access database ready';
      button.disabled = true;
    } else setBusy(button, false);
  }
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#login-submit');
  setMessage($('#login-error'), '');
  setBusy(button, true, 'Signing in…');
  try {
    const result = await postAuth('login', {
      email: $('#login-email').value.trim(), password: $('#login-password').value
    }, '');
    sessionToken = result.token;
    $('#login-password').value = '';
    showAuthenticatedView(result.user);
  } catch (error) {
    setMessage($('#login-error'), error.message || 'Could not sign in.');
  } finally { setBusy(button, false); }
});

$('#bootstrap-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#bootstrap-submit');
  setMessage($('#bootstrap-error'), '');
  setBusy(button, true, 'Setting up…');
  try {
    const username = $('#bootstrap-username').value.trim();
    const password = $('#bootstrap-password').value;
    const headers = authHeaders('');
    const bytes = new TextEncoder().encode(username + ':' + password);
    headers.Authorization = 'Basic ' + btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    const response = await fetch(BOOTSTRAP_API_URL, {
      method: 'POST', headers, cache: 'no-store',
      body: JSON.stringify({
        name: $('#bootstrap-name').value.trim(),
        email: $('#bootstrap-email').value.trim(),
        password: $('#bootstrap-new-password').value
      })
    });
    const result = await readJson(response);
    sessionToken = result.token;
    $('#bootstrap-form').reset();
    showAuthenticatedView(result.user);
  } catch (error) {
    setMessage($('#bootstrap-error'), error.message || 'Could not complete first-time setup.');
  } finally { setBusy(button, false); }
});

document.querySelectorAll('.password-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.target);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Hide' : 'Show';
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(visible));
    input.focus();
  });
});

const dateTime = (input) => {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return { date: '—', time: '—' };
  return {
    date: new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
  };
};

const duration = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  return value < 60 ? value + ' sec' : Math.floor(value / 60) + 'm ' + String(value % 60).padStart(2, '0') + 's';
};

async function loadCalls() {
  if (!sessionToken || loading) return;
  loading = true;
  $('#refresh').disabled = true;
  $('#row-hint').textContent = 'Loading calls…';
  setMessage($('#report-alert'), '');
  const query = new URLSearchParams({ from: $('#from').value, to: $('#to').value, search: $('#search').value.trim(), status });
  try {
    const response = await fetch(REPORTS_API_URL + '?' + query.toString(), {
      method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + sessionToken }, cache: 'no-store'
    });
    const body = await readJson(response);
    const calls = Array.isArray(body.rows) ? body.rows : [];
    $('#total').textContent = Number(body.total || 0).toLocaleString('en-IN');
    $('#answered').textContent = Number(body.answered || 0).toLocaleString('en-IN');
    $('#missed').textContent = Number(body.missed || 0).toLocaleString('en-IN');
    $('#rate').textContent = Number(body.answerRate || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + '%';
    $('#rows').innerHTML = calls.map((call) => {
      const when = dateTime(call.callAt);
      const answered = String(call.callType).toUpperCase() === 'ANSWERED';
      const recordingUrl = /^https:\/\//i.test(String(call.recordingUrl || '')) ? String(call.recordingUrl) : '';
      return '<tr><td>' + escapeHtml(when.date) + '</td><td>' + escapeHtml(when.time) + '</td><td><span class="status ' + (answered ? 'answered' : 'missed') + '">' +
        (answered ? 'Answered' : 'Missed') + '</span></td><td>' + escapeHtml(call.customerName || 'Unknown caller') + '</td><td class="phone">' + escapeHtml(call.customerNumber || '—') +
        '</td><td>' + escapeHtml(call.agent || '—') + '</td><td>' + escapeHtml(duration(call.durationSeconds)) + '</td><td>' +
        (recordingUrl ? '<a class="recording" href="' + escapeHtml(recordingUrl) + '" target="_blank" rel="noopener noreferrer">Open</a>' : '—') + '</td></tr>';
    }).join('');
    $('#empty').hidden = calls.length > 0;
    $('#truncated').hidden = !body.truncated;
    $('#row-hint').textContent = calls.length.toLocaleString('en-IN') + (calls.length === 1 ? ' call shown' : ' calls shown');
  } catch (error) {
    if (/session expired|sign in again/i.test(error.message)) {
      showLogin();
      setMessage($('#login-error'), 'Your session expired. Sign in again.');
      return;
    }
    $('#rows').innerHTML = '';
    $('#empty').hidden = true;
    $('#row-hint').textContent = 'Unable to load calls';
    setMessage($('#report-alert'), error.message || 'Could not load call reports.');
  } finally {
    loading = false;
    $('#refresh').disabled = false;
  }
}

$('#filters').addEventListener('submit', (event) => { event.preventDefault(); loadCalls(); });
$('#refresh').addEventListener('click', loadCalls);
document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  status = button.dataset.status;
  document.querySelectorAll('.tab').forEach((tab) => tab.setAttribute('aria-pressed', String(tab === button)));
  loadCalls();
}));
$('#sign-out').addEventListener('click', async () => {
  try { await postAuth('logout'); } catch { /* Clear the local session even if logout cannot reach n8n. */ }
  showLogin();
  setMessage($('#login-error'), 'You have signed out.');
});

function openUsers() {
  $('#users-view').hidden = false;
  $('#users-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
  loadUsers();
}
$('#manage-users').addEventListener('click', openUsers);
$('#close-users').addEventListener('click', () => { $('#users-view').hidden = true; });

async function loadUsers() {
  setMessage($('#users-alert'), '');
  try {
    const result = await postAuth('list_users');
    const users = Array.isArray(result.users) ? result.users : [];
    $('#user-count').textContent = users.length + (users.length === 1 ? ' account' : ' accounts');
    $('#users-empty').hidden = users.length > 0;
    $('#user-rows').innerHTML = users.map((user) => {
      const canEdit = currentUser.role === 'super_admin' || user.role !== 'super_admin';
      const actions = canEdit
        ? '<div class="row-actions"><button class="button" type="button" data-edit="' + escapeHtml(user.id) + '">Edit</button><button class="button" type="button" data-reset="' + escapeHtml(user.id) + '">Password</button></div>'
        : '—';
      return '<tr><td>' + escapeHtml(user.name) + '</td><td>' + escapeHtml(user.email) + '</td><td class="role-label">' + escapeHtml(user.role.replace('_', ' ')) + '</td><td><span class="account-state ' + (user.active ? '' : 'inactive') + '">' + (user.active ? 'Active' : 'Inactive') + '</span></td><td>' + actions + '</td></tr>';
    }).join('');
    $('#user-rows').querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => editUser(users.find((u) => u.id === button.dataset.edit))));
    $('#user-rows').querySelectorAll('[data-reset]').forEach((button) => button.addEventListener('click', () => resetPassword(users.find((u) => u.id === button.dataset.reset))));
  } catch (error) { setMessage($('#users-alert'), error.message || 'Could not load staff accounts.'); }
}

function editUser(user) {
  if (!user) return;
  $('#edit-id').value = user.id;
  $('#edit-name').value = user.name;
  $('#edit-email').value = user.email;
  $('#edit-active').checked = !!user.active;
  $('#edit-role').innerHTML = (currentUser.role === 'super_admin' ? ['user', 'admin', 'super_admin'] : ['user', 'admin'])
    .map((role) => '<option value="' + role + '">' + role.replace('_', ' ') + '</option>').join('');
  $('#edit-role').value = user.role;
  $('#edit-user-form').hidden = false;
  $('#reset-password-form').hidden = true;
  $('#edit-user-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetPassword(user) {
  if (!user) return;
  $('#reset-id').value = user.id;
  $('#reset-title').textContent = 'Set a new password for ' + user.name;
  $('#reset-password').value = '';
  $('#reset-password-form').hidden = false;
  $('#edit-user-form').hidden = true;
  $('#reset-password-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('#create-user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setMessage($('#create-user-error'), '');
  setBusy(button, true, 'Creating…');
  try {
    await postAuth('create_user', { name: $('#new-name').value.trim(), email: $('#new-email').value.trim(), role: $('#new-role').value, password: $('#new-password').value });
    $('#create-user-form').reset();
    setMessage($('#users-alert'), 'Account created. Share the initial password securely.');
    await loadUsers();
  } catch (error) { setMessage($('#create-user-error'), error.message || 'Could not create account.'); }
  finally { setBusy(button, false); }
});

$('#edit-user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Saving…');
  try {
    await postAuth('update_user', { id: $('#edit-id').value, name: $('#edit-name').value.trim(), email: $('#edit-email').value.trim(), role: $('#edit-role').value, active: $('#edit-active').checked });
    $('#edit-user-form').hidden = true;
    setMessage($('#users-alert'), 'Account updated.');
    await loadUsers();
    const me = await postAuth('me');
    currentUser = me.user;
    $('#account-chip').textContent = currentUser.name + ' · ' + currentUser.role.replace('_', ' ');
  } catch (error) { setMessage($('#users-alert'), error.message || 'Could not update account.'); }
  finally { setBusy(button, false); }
});

$('#reset-password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, 'Changing…');
  try {
    await postAuth('reset_password', { id: $('#reset-id').value, password: $('#reset-password').value });
    $('#reset-password-form').reset();
    $('#reset-password-form').hidden = true;
    setMessage($('#users-alert'), 'Password changed. That user must sign in again.');
    await loadUsers();
  } catch (error) { setMessage($('#users-alert'), error.message || 'Could not change password.'); }
  finally { setBusy(button, false); }
});

$('#cancel-edit').addEventListener('click', () => { $('#edit-user-form').hidden = true; });
$('#cancel-reset').addEventListener('click', () => { $('#reset-password-form').hidden = true; });

if (location.protocol === 'file:') {
  $('#signin-panel').hidden = false;
  setMessage($('#login-error'), 'Open the hosted reports website to connect securely.');
} else {
  checkBootstrap();
}
window.setInterval(() => { if (sessionToken && !document.hidden) loadCalls(); }, 30000);
