(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    return;
  }

  if (!document.body || !document.body.hasAttribute('data-lti-proctor-shell')) {
    return;
  }

  function getUrl() {
    var el = document.getElementById('lti-test-runner-url');
    if (!el) return '';
    return (el.value || el.getAttribute('value') || '').trim();
  }

  function setStatus(t, showOverlay) {
    var s = document.getElementById('status');
    if (s) s.textContent = t;
    var o = document.getElementById('shell-pause-hint');
    if (o) {
      if (showOverlay) o.classList.add('on');
      else o.classList.remove('on');
    }
  }

  function btnAction(id) {
    if (id === 'btn-launch-quiz') return 'launch';
    if (id === 'btn-play') return 'play';
    if (id === 'btn-pause') return 'pause';
    if (id === 'btn-stop') return 'stop';
    return null;
  }

  document.addEventListener(
    'click',
    function (e) {
      var raw = e.target;
      var el0 = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement;
      var el = el0 && el0.closest ? el0.closest('button') : null;
      if (!el || !el.id) return;
      var op = btnAction(el.id);
      if (!op) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();

      var testRunnerUrl = (getUrl() || '').trim();
      if (op === 'launch' && !testRunnerUrl) {
        return;
      }

      var payload = { type: 'proctor', op: op };
      if (op === 'launch') payload.testRunnerUrl = testRunnerUrl;

      chrome.runtime.sendMessage(payload, function (res) {
        if (chrome.runtime.lastError) {
          setStatus('Extension: ' + chrome.runtime.lastError.message, false);
          return;
        }
        if (res && res.ok) {
          if (op === 'launch' && res.quizTabId) {
            setStatus('Running (quiz tab)', false);
          }
        } else if (res && res.error) {
          setStatus('Error: ' + res.error, false);
        }
      });
    },
    true,
  );

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== 'proctorStatus' || !msg.text) return;
    setStatus(msg.text, msg.overlayVisible === true);
  });
})();
