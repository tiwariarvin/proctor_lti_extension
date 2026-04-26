import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bodyParser from 'body-parser';
import { nanoid } from 'nanoid';
import { config, redirectUri, loginInitiationUri } from './config.js';
import { verifyLtiLaunchToken } from './ltiJwt.js';
import { createOidcStateJwt, verifyOidcStateJwt } from './oidcState.js';

/**
 * @param {string | null | undefined} s
 */
function escapeHtmlAttr(s) {
  if (s == null || s === undefined) {
    return '';
  }
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

const app = express();
app.set('trust proxy', 1);
app.use(bodyParser.urlencoded({ extended: false }));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '..', 'public')));

function buildAuthRedirectUrl({
  loginHint,
  ltiMessageHint,
  targetLinkUri,
  clientId,
  state,
  nonce,
}) {
  const u = new URL(config.platformOidcAuthUrl);
  const p = u.searchParams;
  p.set('response_type', 'id_token');
  p.set('response_mode', 'form_post');
  p.set('prompt', 'none');
  p.set('scope', 'openid');
  p.set('client_id', clientId);
  p.set('redirect_uri', redirectUri());
  p.set('state', state);
  p.set('nonce', nonce);
  p.set('login_hint', loginHint);
  if (ltiMessageHint) p.set('lti_message_hint', ltiMessageHint);
  if (targetLinkUri) p.set('target_link_uri', targetLinkUri);
  return u.toString();
}

function renderShellPage({ testRunnerUrl, userName, deploymentId }) {
  const boot = {
    testRunnerUrl,
    userName,
    deploymentId,
    controlChannel: 'd2l-lti-test-runner-control',
  };

  const bootJson = JSON.stringify(boot)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  const urlForInput = escapeHtmlAttr(testRunnerUrl || '');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Test session (LTI)</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: system-ui, sans-serif; min-height: 100vh; display: flex; flex-direction: column; }
    body[data-lti-proctor-shell] { height: 100vh; }
    header {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px;
      border-bottom: 1px solid #ccc; flex-wrap: wrap;
    }
    header h1 { font-size: 1rem; margin: 0; flex: 1 1 auto; }
    .btn {
      border: 1px solid #888; background: #f4f4f4; color: inherit; border-radius: 8px;
      padding: 8px 14px; font: inherit; cursor: pointer;
    }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn.primary { background: #1a5fb4; color: #fff; border-color: #174ea0; }
    .main {
      flex: 1; min-height: 0; display: flex; flex-direction: column;
      position: relative;
    }
    .panel { flex: 1; padding: 20px; color: inherit; }
    .banner { padding: 12px 14px; border-bottom: 1px solid #c9a227; background: #fff7d6; color: #3b3200; }
    .meta { font-size: 0.85rem; opacity: 0.85; }
    .shell-pause { display: none; padding: 6px 12px; background: #3b3200; color: #fff7d6; font-size: 0.85rem; }
    .shell-pause.on { display: block; }
  </style>
</head>
<body data-lti-proctor-shell>
  <input type="hidden" id="lti-test-runner-url" value="${urlForInput}" />
  <header>
    <h1>Test session</h1>
    <button class="btn primary" type="button" id="btn-launch-quiz" title="Open Brightspace quiz in a new browser tab">Open quiz</button>
    <button class="btn" type="button" id="btn-play" title="Focus the quiz tab">Play</button>
    <button class="btn" type="button" id="btn-pause" title="Dim / block the quiz tab (extension required)">Pause</button>
    <button class="btn" type="button" id="btn-stop" title="Close the quiz tab">Stop</button>
    <span class="meta" id="status">Idle</span>
  </header>
  <div id="shell-pause-hint" class="shell-pause" role="status" aria-live="polite">Quiz tab interaction is paused (see Brightspace window).</div>
  <div class="banner" id="no-url" hidden>
    No <code>test_runner_url</code> was provided on this launch. In Brightspace, add a custom parameter
    <code>test_runner_url</code> on the link/deployment, or set <code>DEFAULT_TEST_RUNNER_URL</code> in the tool server environment.
  </div>
  <div class="main">
    <div class="panel" id="hint">
      Use <strong>Open quiz</strong> to open the Brightspace quiz in a new tab, then <strong>Play</strong> / <strong>Pause</strong> / <strong>Stop</strong> to focus, block, or <strong>close that tab</strong>. Install the <em>D2L LTI quiz tab proctor</em> extension for Pause (overlay) and reliable tab control; without it, Stop uses <code>window.close</code> on the window your browser still associates with this page.
    </div>
  </div>
  <script>
    window.__LTI_TEST_RUNNER__ = ${bootJson};
  </script>
  <script>
    (function () {
      var cfg = window.__LTI_TEST_RUNNER__ || {};
      var status = document.getElementById('status');
      var noUrl = document.getElementById('no-url');
      var btnLaunch = document.getElementById('btn-launch-quiz');
      var btnPlay = document.getElementById('btn-play');
      var btnPause = document.getElementById('btn-pause');
      var btnStop = document.getElementById('btn-stop');
      var shellPauseHint = document.getElementById('shell-pause-hint');
      var quizWindow = null;

      function hasOpenQuizTab() {
        return !!quizWindow && !quizWindow.closed;
      }

      function setStatus(t) {
        status.textContent = t;
      }

      function setShellPause(v) {
        if (!shellPauseHint) return;
        if (v) shellPauseHint.classList.add('on');
        else shellPauseHint.classList.remove('on');
      }

      function syncLaunchButton() {
        if (btnLaunch) btnLaunch.disabled = !cfg.testRunnerUrl;
      }

      if (btnLaunch) {
        btnLaunch.addEventListener('click', function () {
          var url = cfg.testRunnerUrl;
          if (!url) return;
          if (hasOpenQuizTab() && !window.confirm('Close the current quiz window and open a new one?')) {
            return;
          }
          if (hasOpenQuizTab()) {
            try { quizWindow.close(); } catch (e) {}
            quizWindow = null;
          }
          quizWindow = window.open(url, 'd2l_lti_proctor_quiz', 'noopener,noreferrer');
          if (!quizWindow) {
            setStatus('Could not open tab (popup may be blocked)');
            return;
          }
          setShellPause(false);
          setStatus('Running (quiz tab)');
        });
      }

      if (btnPlay) {
        btnPlay.addEventListener('click', function () {
          if (!hasOpenQuizTab()) {
            setStatus('No quiz tab — use Open quiz first');
            return;
          }
          try {
            quizWindow.focus();
            setStatus('Running (quiz tab)');
            setShellPause(false);
          } catch (e) {
            setStatus('Could not focus quiz window');
          }
        });
      }

      if (btnPause) {
        btnPause.addEventListener('click', function () {
          if (!hasOpenQuizTab()) return;
          setStatus('Pause: install the proctor extension to block interaction in the Brightspace tab');
        });
      }

      if (btnStop) {
        btnStop.addEventListener('click', function () {
          if (!hasOpenQuizTab()) return;
          try { quizWindow.close(); } catch (e) {}
          if (quizWindow && !quizWindow.closed) {
            setStatus('Stop: install the proctor extension to close the quiz tab');
            return;
          }
          quizWindow = null;
          setShellPause(false);
          setStatus('Stopped (quiz tab closed)');
        });
      }

      setInterval(function () {
        if (quizWindow && quizWindow.closed) {
          quizWindow = null;
          setShellPause(false);
          setStatus('Quiz tab was closed');
        }
      }, 1000);

      if (!cfg.testRunnerUrl) {
        noUrl.hidden = false;
        setStatus('Missing URL');
      } else {
        setStatus('Use Open quiz to begin');
      }
      syncLaunchButton();
    })();
  </script>
</body>
</html>`;
}

async function handleLogin(req, res) {
  const q = { ...req.query, ...req.body };
  const iss = String(q.iss || '');
  const loginHint = String(q.login_hint || '');
  const targetLinkUri = String(q.target_link_uri || '');
  const ltiMessageHint = q.lti_message_hint != null ? String(q.lti_message_hint) : '';
  const clientId = String(q.client_id || '');

  if (!iss || !loginHint || !targetLinkUri || !clientId) {
    res.status(400).send('Missing OIDC parameters (iss, login_hint, target_link_uri, client_id).');
    return;
  }

  if (iss.replace(/\/$/, '') !== config.platformIssuer.replace(/\/$/, '')) {
    res.status(400).send('Unexpected issuer.');
    return;
  }

  if (clientId !== config.ltiClientId) {
    res.status(400).send('Unexpected client_id.');
    return;
  }

  const nonce = nanoid(32);
  let stateJwt;
  try {
    stateJwt = await createOidcStateJwt({
      nonce,
      iss,
      clientId,
      targetLinkUri,
      loginHint,
      ltiMessageHint,
    });
  } catch {
    res.status(500).send('Failed to create OIDC state.');
    return;
  }

  const redirectUrl = buildAuthRedirectUrl({
    loginHint,
    ltiMessageHint,
    targetLinkUri,
    clientId,
    state: stateJwt,
    nonce,
  });

  res.redirect(redirectUrl);
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/lti/login', handleLogin);
app.post('/lti/login', handleLogin);

app.post('/lti/launch', async (req, res) => {
  const idToken = req.body?.id_token;
  const stateJwt = req.body?.state;

  if (typeof idToken !== 'string' || !idToken || typeof stateJwt !== 'string' || !stateJwt) {
    res.status(400).send('Missing id_token or state.');
    return;
  }

  let oidcCtx;
  try {
    oidcCtx = await verifyOidcStateJwt(stateJwt);
  } catch {
    res.status(400).send('Invalid or expired OIDC state.');
    return;
  }

  if (oidcCtx.iss.replace(/\/$/, '') !== config.platformIssuer.replace(/\/$/, '')) {
    res.status(400).send('Unexpected issuer in OIDC state.');
    return;
  }

  if (oidcCtx.clientId !== config.ltiClientId) {
    res.status(400).send('Unexpected client_id in OIDC state.');
    return;
  }

  try {
    const launch = await verifyLtiLaunchToken(idToken, oidcCtx.nonce);
    let ancestors = `'self' ${config.platformIssuer}`;
    try {
      ancestors += ` ${new URL(config.platformIssuer).origin}`;
    } catch {
      // ignore
    }
    res.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
    res
      .type('html')
      .send(
        renderShellPage({
          testRunnerUrl: launch.testRunnerUrl,
          userName: launch.user.name,
          deploymentId: launch.deploymentId,
        }),
      );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Launch failed';
    res.status(400).send(`LTI launch validation failed: ${msg}`);
  }
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>LTI tool</title>
  <p>OIDC Login initiation URL (register in Brightspace): <code>${loginInitiationUri()}</code></p>
  <p>Redirect / launch URL: <code>${redirectUri()}</code></p>`);
});

app.listen(config.port, () => {
  console.log(`Listening on http://localhost:${config.port}`);
});
