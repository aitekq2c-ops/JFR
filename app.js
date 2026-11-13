const $ = (selector) => document.querySelector(selector);
const REPORTS_API_URL = 'https://n8n.srv1864214.hstgr.cloud/webhook/jfr-call-reports';
const loginForm = $('#login-form');
const filtersForm = $('#filters');
let status = 'ALL';
let reportUsername = '';
let reportPassword = '';
let authenticated = false;
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

const dateTime = (input) => {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return { date: '—', time: '—' };
  return {
    date: new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(date),
    time: new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(date)
  };
};

const duration = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  return value < 60
    ? value + ' sec'
    : Math.floor(value / 60) + 'm ' + String(value % 60).padStart(2, '0') + 's';
};

function basicAuthHeader(username, password) {
  const bytes = new TextEncoder().encode(username + ':' + password);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return 'Basic ' + btoa(binary);
}

function showLoginError(message) {
  const error = $('#login-error');
  error.textContent = message;
  error.hidden = !message;
}

function returnToLogin(message) {
  authenticated = false;
  reportPassword = '';
  $('#password').value = '';
  $('#login-view').hidden = false;
  $('#reports-view').hidden = true;
  showLoginError(message);
  $('#password').focus();
}

async function loadCalls(isSignIn = false) {
  if (!reportUsername || !reportPassword || loading) return;

  if (location.protocol === 'file:') {
    showLoginError('Open the hosted reports website to sign in. Local file preview cannot connect to reports.');
    return;
  }

  const query = new URLSearchParams({
    from: $('#from').value,
    to: $('#to').value,
    search: $('#search').value.trim(),
    status
  });
  const refreshButton = $('#refresh');
  const signInButton = $('#sign-in');
  loading = true;
  if (refreshButton) refreshButton.disabled = true;
  if (isSignIn) {
    signInButton.disabled = true;
    signInButton.textContent = 'Signing in…';
  }
  document.body.classList.add('loading');
  $('#alert').classList.remove('visible');
  $('#row-hint').textContent = 'Loading calls…';

  try {
    let response;
    try {
      response = await fetch(REPORTS_API_URL + '?' + query.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: basicAuthHeader(reportUsername, reportPassword)
        },
        cache: 'no-store'
      });
    } catch {
      throw new Error('Could not connect to reports. Check your internet connection and try again.');
    }

    if (response.status === 401 || response.status === 403) {
      returnToLogin('Username or password is incorrect. Please try again.');
      return;
    }

    const responseText = await response.text();
    let body;
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error('The reports service returned an unexpected response. Please try again later.');
    }

    if (!response.ok) throw new Error(body.error || 'Could not load call reports. Please try again.');

    const calls = Array.isArray(body.rows) ? body.rows : [];
    $('#total').textContent = Number(body.total || 0).toLocaleString('en-IN');
    $('#answered').textContent = Number(body.answered || 0).toLocaleString('en-IN');
    $('#missed').textContent = Number(body.missed || 0).toLocaleString('en-IN');
    $('#rate').textContent = Number(body.answerRate || 0).toLocaleString('en-IN', {
      maximumFractionDigits: 1
    }) + '%';

    $('#rows').innerHTML = calls.map((call) => {
      const when = dateTime(call.callAt);
      const answered = String(call.callType).toUpperCase() === 'ANSWERED';
      const recordingUrl = /^https:\/\//i.test(String(call.recordingUrl || ''))
        ? String(call.recordingUrl)
        : '';
      return '<tr><td>' + escapeHtml(when.date) + '</td><td>' + escapeHtml(when.time) +
        '</td><td><span class="status ' + (answered ? 'answered' : 'missed') + '">' +
        (answered ? 'Answered' : 'Missed') + '</span></td><td>' +
        escapeHtml(call.customerName || 'Unknown caller') + '</td><td class="phone">' +
        escapeHtml(call.customerNumber || '—') + '</td><td>' + escapeHtml(call.agent || '—') +
        '</td><td>' + escapeHtml(duration(call.durationSeconds)) + '</td><td>' +
        (recordingUrl
          ? '<a class="recording" href="' + escapeHtml(recordingUrl) +
            '" target="_blank" rel="noopener noreferrer">Open</a>'
          : '—') + '</td></tr>';
    }).join('');

    authenticated = true;
    $('#login-view').hidden = true;
    $('#reports-view').hidden = false;
    $('#password').value = '';
    showLoginError('');
    $('#empty').hidden = calls.length > 0;
    $('#truncated').hidden = !body.truncated;
    $('#row-hint').textContent = calls.length.toLocaleString('en-IN') +
      (calls.length === 1 ? ' call shown' : ' calls shown');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load call reports.';
    if (!authenticated) {
      showLoginError(message);
      $('#row-hint').textContent = 'Sign in to load calls';
    } else {
      $('#rows').innerHTML = '';
      $('#empty').hidden = true;
      $('#row-hint').textContent = 'Unable to load calls';
      $('#alert').textContent = message;
      $('#alert').classList.add('visible');
    }
  } finally {
    loading = false;
    if (refreshButton) refreshButton.disabled = false;
    signInButton.disabled = false;
    signInButton.textContent = 'Sign in';
    document.body.classList.remove('loading');
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  reportUsername = $('#username').value.trim();
  reportPassword = $('#password').value;
  showLoginError('');
  loadCalls(true);
});

$('#password-toggle').addEventListener('click', () => {
  const password = $('#password');
  const visible = password.type === 'password';
  password.type = visible ? 'text' : 'password';
  $('#password-toggle').textContent = visible ? 'Hide' : 'Show';
  $('#password-toggle').setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  $('#password-toggle').setAttribute('aria-pressed', String(visible));
  password.focus();
});

filtersForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadCalls();
});
$('#refresh').addEventListener('click', () => loadCalls());
$('#sign-out').addEventListener('click', () => {
  reportUsername = '';
  returnToLogin('');
  $('#row-hint').textContent = 'Sign in to load calls';
});

document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  status = button.dataset.status;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('aria-pressed', String(tab === button));
  });
  loadCalls();
}));

window.setInterval(() => {
  if (authenticated && reportPassword) loadCalls();
}, 30000);
