const $ = (selector) => document.querySelector(selector);
    const form = $('#filters');
    let status = 'ALL';
    let reportPassword = '';
    const dateInKolkata = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = dateInKolkata.format(new Date());
    $('#from').value = today; $('#to').value = today;
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const dateTime = (input) => {
      const date = new Date(input);
      if (Number.isNaN(date.getTime())) return { date: '—', time: '—' };
      return { date: new Intl.DateTimeFormat('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'2-digit', year:'numeric' }).format(date), time: new Intl.DateTimeFormat('en-IN', { timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(date) };
    };
    const duration = (seconds) => { const n = Math.max(0, Number(seconds) || 0); return n < 60 ? n + ' sec' : Math.floor(n/60) + 'm ' + String(n%60).padStart(2,'0') + 's'; };
    async function loadCalls() {
      if (location.protocol === 'file:') {
        $('#row-hint').textContent = 'Local preview · live data needs hosting';
        $('#empty').innerHTML = '<strong>Preview only</strong>Host this website and connect the n8n webhook to load calls.';
        $('#empty').hidden = false;
        return;
      }
      const query = new URLSearchParams({ from: $('#from').value, to: $('#to').value, search: $('#search').value.trim(), status });
      const button = $('#refresh'); button.disabled = true; document.body.classList.add('loading'); $('#alert').classList.remove('visible'); $('#row-hint').textContent = 'Loading calls…';
      try {
        let response;
        let body;
        let authAttempts = 0;
        while (true) {
          const headers = { Accept: 'application/json' };
          if (reportPassword) {
            const authBytes = new TextEncoder().encode('reports:' + reportPassword);
            const authBinary = Array.from(authBytes, byte => String.fromCharCode(byte)).join('');
            headers.Authorization = 'Basic ' + btoa(authBinary);
          }
          response = await fetch('/api/calls.php?' + query.toString(), { headers, cache: 'no-store' });
          const responseText = await response.text();
          try {
            body = JSON.parse(responseText);
          } catch {
            throw new Error('Reports API returned HTTP ' + response.status + ' without JSON. Deploy the Hostinger API proxy at /api/calls.php.');
          }
          if (response.status !== 401) break;
          if (authAttempts >= 2) throw new Error('Staff password was not accepted.');
          const enteredPassword = window.prompt('Enter the staff password for call reports:');
          if (!enteredPassword) throw new Error('Staff sign-in was cancelled.');
          reportPassword = enteredPassword;
          authAttempts += 1;
        }
        if (!response.ok) throw new Error(body.error || 'Could not load call reports.');
        const calls = Array.isArray(body.rows) ? body.rows : [];
        $('#total').textContent = Number(body.total || 0).toLocaleString('en-IN');
        $('#answered').textContent = Number(body.answered || 0).toLocaleString('en-IN');
        $('#missed').textContent = Number(body.missed || 0).toLocaleString('en-IN');
        $('#rate').textContent = (Number(body.answerRate || 0)).toLocaleString('en-IN', { maximumFractionDigits:1 }) + '%';
        $('#rows').innerHTML = calls.map(call => {
          const when = dateTime(call.callAt); const answered = String(call.callType).toUpperCase() === 'ANSWERED';
          const recordingUrl = /^https:\/\//i.test(String(call.recordingUrl || '')) ? String(call.recordingUrl) : '';
          return '<tr><td>' + escapeHtml(when.date) + '</td><td>' + escapeHtml(when.time) + '</td><td><span class="status ' + (answered?'answered':'missed') + '">' + (answered?'Answered':'Missed') + '</span></td><td>' + escapeHtml(call.customerName || 'Unknown caller') + '</td><td class="phone">' + escapeHtml(call.customerNumber || '—') + '</td><td>' + escapeHtml(call.agent || '—') + '</td><td>' + escapeHtml(duration(call.durationSeconds)) + '</td><td>' + (recordingUrl ? '<a class="recording" href="' + escapeHtml(recordingUrl) + '" target="_blank" rel="noopener noreferrer">Open</a>' : '—') + '</td></tr>';
        }).join('');
        $('#empty').hidden = calls.length > 0; $('#truncated').hidden = !body.truncated;
        $('#row-hint').textContent = calls.length.toLocaleString('en-IN') + (calls.length === 1 ? ' call shown' : ' calls shown');
      } catch (error) {
        $('#rows').innerHTML = ''; $('#empty').hidden = true; $('#row-hint').textContent = 'Unable to load calls';
        $('#alert').textContent = error instanceof Error ? error.message : 'Could not load call reports.'; $('#alert').classList.add('visible');
      } finally { button.disabled = false; document.body.classList.remove('loading'); }
    }
    form.addEventListener('submit', event => { event.preventDefault(); loadCalls(); });
    $('#refresh').addEventListener('click', loadCalls);
    document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => { status = button.dataset.status; document.querySelectorAll('.tab').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button))); loadCalls(); }));
    loadCalls();
