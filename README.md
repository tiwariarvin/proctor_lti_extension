# D2L LTI quiz tab proctor (browser extension)

Chrome/Edge **Manifest V3** extension that works with the **proctor LTI shell** in the parent project (`../src/server.js`). The shell can be embedded in Brightspace (for example in an **iframe**). This extension **opens, focuses, overlays, and closes** the **Brightspace quiz** tab the instructor configured via the LTI custom parameter `test_runner_url` (or the tool’s `DEFAULT_TEST_RUNNER_URL`).

**Stop** means **close the quiz tab** (`chrome.tabs.remove`).

## Install (development)

1. Open **Chrome** or **Edge**:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Turn on **Developer mode** (or **Developer mode** in the sidebar in Edge).
3. Click **Load unpacked** and select this **`extension`** directory (the folder that contains `manifest.json`).

Reload the extension after you change any file. Reload the **proctor** page in Brightspace after loading or updating the extension.

## What you need first

- The **Node** LTI tool from the [project root `README.md`](../README.md) is deployed and the Brightspace LTI link includes a custom **`test_runner_url`** (absolute URL) pointing at the quiz page to open in a new tab.

Without that URL, **Open quiz** has nothing to load.

## What each button does (with this extension)

| Shell control | Extension behavior |
| --- | --- |
| **Open quiz** | `chrome.tabs.create` with the URL from `#lti-test-runner-url`. Re-opening replaces a **previously** opened quiz tab tied to the same proctor view (if any). |
| **Play** | Focus the **quiz** tab and window; remove the pause **overlay** in that tab, if present. |
| **Pause** | Injects a full-page semi-transparent **overlay** on the **quiz** tab to block most pointer input (not a true server-side pause of the quiz). |
| **Stop** | Removes the **overlay** (if any) and **closes** the quiz **tab**. |

The extension also **updates the shell** status (for example if the user closes the quiz tab manually) via messages to the content script.

## How it fits together

1. The learner opens the proctor LTI page. The page has `body` **`data-lti-proctor-shell`** and a hidden **`#lti-test-runner-url`** the server set at launch.
2. **`content-lti-bridge.js`** runs in **all frames** but **does nothing** on pages that are not the shell (no `data-lti-proctor-shell` early return).
3. The content script uses **capture-phase** `click` handlers on the proctor **Open / Play / Pause / Stop** buttons, then **`chrome.runtime.sendMessage`** to the service worker.
4. **`background.js`** maps each **browser tab and frame** that shows the proctor UI to a **single quiz `tabId`** in `chrome.storage.session` (so multiple iframes or one top-level proctor are isolated correctly).
5. The service worker uses **`chrome.tabs`**, **`chrome.scripting.executeScript`**, and **`chrome.windows`** to act on the quiz tab.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, permissions, content script registration. |
| `background.js` | Service worker: session keys, `launch` / `play` / `pause` / `stop`, overlay inject/clear, notify shell on status. |
| `content-lti-bridge.js` | Binds the shell UI to runtime messages, updates `#status` and `#shell-pause-hint`. |

## Permissions and host access

- **`tabs`** — Create, focus, read, and remove the quiz tab.
- **`scripting`** — Inject the pause **overlay** into the Brightspace page in that tab.
- **`storage`**, `chrome.storage.session` — Map proctor (tab, frame) → quiz `tabId` for the current browser session.
- **`host_permissions`: `https://*/*` and `http://*/*`** — Lets `executeScript` run in the Brightspace tab. For a **tighter** profile, **replace** these with a single **origin** pattern, for example `https://yoursite.brightspace.com/*` (and any other hosts you use), then reload the extension.

`content_scripts.matches` is **`"`<all_urls>`"** so the shell is found no matter which host the tool is deployed on. The script is cheap: it only activates when `data-lti-proctor-shell` is present. For production, you can restrict **`matches`** to the known tool origin if you have a fixed FQDN.

## Troubleshooting

- **Controls still behave like a normal page (no “real” new tab or close from Stop)** — Confirm the extension is **enabled**, **Load unpacked** points at this folder, and **reload** the proctor page. Without the content script, the page falls back to `window.open` / `window.close` only when the browser allows.
- **Pause does nothing in the quiz** — The overlay is injected in the **quiz** tab. Some subviews, strict CSP, or iframes inside the quiz can limit coverage; this is a **best-effort** UI block.
- **Wrong quiz tab** — Re-open a quiz with **Open quiz** after changing `test_runner_url` or the deployment link so `#lti-test-runner-url` matches what you expect.

## Publishing

This build is set up for **unpacked** testing. Publishing to the **Chrome Web Store** (or **Edge Add-ons**) requires a separate packaging flow, a privacy policy, and a narrower permission story than the current broad `https` / `http` / `<all_urls>` settings.

## See also

- [Top-level `README.md`](../README.md) — LTI registration, environment, and the full proctor **shell** behavior.
