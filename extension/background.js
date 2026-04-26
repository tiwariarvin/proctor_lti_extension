const SESSION_PREFIX = 'proctorQuiz:';

/**
 * @param {number} tabId
 * @param {number} [frameId]
 */
function sessionKey(tabId, frameId = 0) {
  return `${SESSION_PREFIX}${tabId}-${frameId}`;
}

/**
 * @param {number} tabId
 */
async function injectPauseOverlay(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: function inject() {
      const id = 'd2l-lti-proctor-pause-overlay';
      if (document.getElementById(id)) return;
      const d = document.createElement('div');
      d.id = id;
      d.setAttribute('aria-hidden', 'true');
      d.setAttribute('role', 'presentation');
      d.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483646',
        'background:rgba(0,0,0,0.45)',
        'pointer-events:auto',
        'user-select:none',
        '-webkit-user-select:none',
      ].join(';');
      (document.body || document.documentElement).appendChild(d);
    },
  });
}

/**
 * @param {number} tabId
 */
async function clearPauseOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: function clearOvl() {
        const id = 'd2l-lti-proctor-pause-overlay';
        const n = document.getElementById(id);
        if (n && n.remove) n.remove();
      },
    });
  } catch {
    // some frames may be inaccessible; main frame usually still runs
  }
}

/**
 * @param {number} openerTabId
 * @param {number} frameId
 * @param {string} text
 * @param {boolean} [overlayVisible]
 */
function notifyLtiPage(openerTabId, frameId, text, overlayVisible) {
  const m = {
    type: 'proctorStatus',
    text,
    overlayVisible: Boolean(overlayVisible),
  };
  if (frameId > 0) {
    void chrome.tabs.sendMessage(openerTabId, m, { frameId }).catch(() => {});
  } else {
    void chrome.tabs.sendMessage(openerTabId, m).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'proctor') {
    return undefined;
  }

  const tabId = sender.tab?.id;
  if (tabId == null) {
    sendResponse({ ok: false, error: 'no_sender_tab' });
    return false;
  }
  const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
  const key = sessionKey(tabId, frameId);

  (async () => {
    if (msg.op === 'launch') {
      const testRunnerUrl = String(msg.testRunnerUrl || '').trim();
      if (!testRunnerUrl) {
        return { ok: false, error: 'missing_url' };
      }
      const existing = (await chrome.storage.session.get(key))[key];
      if (typeof existing === 'number') {
        try {
          await chrome.tabs.remove(existing);
        } catch {
          // ignore
        }
      }
      const created = await chrome.tabs.create({ url: testRunnerUrl, active: true });
      if (created.id == null) {
        return { ok: false, error: 'create_failed' };
      }
      await chrome.storage.session.set({ [key]: created.id });
      notifyLtiPage(tabId, frameId, 'Running (quiz tab)', false);
      return { ok: true, quizTabId: created.id };
    }

    const store = (await chrome.storage.session.get(key))[key];
    const quizTabId = typeof store === 'number' ? store : null;
    if (quizTabId == null) {
      notifyLtiPage(tabId, frameId, 'No quiz tab — use Open quiz first', false);
      return { ok: false, error: 'no_quiz_tab' };
    }

    let quiz;
    try {
      quiz = await chrome.tabs.get(quizTabId);
    } catch {
      await chrome.storage.session.remove(key);
      notifyLtiPage(tabId, frameId, 'Quiz tab was closed', false);
      return { ok: false, error: 'quiz_tab_gone' };
    }

    if (msg.op === 'play') {
      await clearPauseOverlay(quizTabId);
      await chrome.tabs.update(quizTabId, { active: true });
      if (typeof quiz.windowId === 'number') {
        await chrome.windows.update(quiz.windowId, { focused: true });
      }
      notifyLtiPage(tabId, frameId, 'Running (quiz tab)', false);
      return { ok: true };
    }
    if (msg.op === 'pause') {
      await injectPauseOverlay(quizTabId);
      await chrome.tabs.update(quizTabId, { active: true });
      if (typeof quiz.windowId === 'number') {
        await chrome.windows.update(quiz.windowId, { focused: true });
      }
      notifyLtiPage(
        tabId,
        frameId,
        'Paused (interaction blocked in quiz tab)',
        true,
      );
      return { ok: true };
    }
    if (msg.op === 'stop') {
      try {
        await clearPauseOverlay(quizTabId);
        await chrome.tabs.remove(quizTabId);
      } catch {
        // may already be closed
      }
      await chrome.storage.session.remove(key);
      notifyLtiPage(tabId, frameId, 'Stopped (quiz tab closed)', false);
      return { ok: true };
    }

    return { ok: false, error: 'unknown_op' };
  })()
    .then((r) => {
      try {
        sendResponse(r);
      } catch {
        // channel closed
      }
    })
    .catch((e) => {
      try {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      } catch {
        // channel closed
      }
    });

  return true;
});

chrome.tabs.onRemoved.addListener(async (removedTabId) => {
  const all = await chrome.storage.session.get(null);
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(SESSION_PREFIX) && v === removedTabId) {
      const body = k.slice(SESSION_PREFIX.length);
      const li = body.lastIndexOf('-');
      if (li > 0) {
        const openerTab = Number.parseInt(body.slice(0, li), 10);
        const fId = Number.parseInt(body.slice(li + 1), 10) || 0;
        if (!Number.isNaN(openerTab)) {
          notifyLtiPage(
            openerTab,
            fId,
            'Quiz tab was closed',
            false,
          );
        }
      }
      await chrome.storage.session.remove(k);
    }
  }
});
