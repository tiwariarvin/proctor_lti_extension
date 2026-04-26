# D2L LTI quiz proctor (test runner shell)

LTI 1.3 tool for **Brightspace (D2L)** that completes the OIDC launch and returns a small **proctor-style shell** page. You point **`test_runner_url`** (or **`DEFAULT_TEST_RUNNER_URL`**) at the page to open in a **new browser tab**—for example a **Brightspace quiz** URL. The shell is **not** an iframe; it is designed to work with a **separate tab** plus the optional **browser extension** in [`extension/`](extension/).

- **Open quiz** — open that URL in a new tab.  
- **Play** — focus the quiz tab.  
- **Pause** — with the extension, injects a full-page overlay on the **quiz** tab to block pointer input (not a guaranteed server-side “pause”).  
- **Stop** — with the extension, **closes the quiz tab** (`chrome.tabs.remove`). Without the extension, **Stop** only works if the browser still allows `window.close()` for that window.

**Learner workflow:** open the proctor LTI link → (optional) **Load unpacked** extension in Chrome/Edge for your org → use **Open quiz** → **Play** / **Pause** / **Stop** as needed.

## Prerequisites

- **Node.js 18 or newer** (includes `npm`). [Node.js LTS](https://nodejs.org/) or `winget install OpenJS.NodeJS.LTS` on Windows.
- A **public HTTPS** base URL for this app (reverse proxy, tunnel such as **ngrok**, and so on). Brightspace must reach **`/lti/login`** and **`/lti/launch`**
  over **HTTPS** if that is what you register.
- Brightspace admin: **Settings** (org) → **Manage extensibility** → **LTI Advantage** (wording can vary).
- For **Play / Pause / Stop** to control the **Brightspace tab** itself: the **proctor extension** in [`extension/`](extension/) (Chrome/Edge, Manifest V3), loaded via **Load unpacked** or your org’s software deployment story.

## Quick start

1. Open a terminal in the **project root** and install:

   ```bash
   npm install
   ```

2. Create a **`.env`** file in the project root. If you have a template file (for example **`.env.example`**) in this repo, copy it first. Otherwise, define the variables in [Environment variables](#environment-variables) manually.

3. **Start the server**

   ```bash
   npm start
   ```

   For development with auto-restart on file changes:

   ```bash
   npm run dev
   ```

4. Confirm: **`GET {PUBLIC_BASE_URL}/health`** should return `{"ok": true}` (default **port 3000** unless **`PORT`** is set).

5. (Recommended for production behavior) In Chrome or Edge, open `chrome://extensions` or `edge://extensions` → **Developer mode** on → **Load unpacked** → select the **`extension`** directory from this project.

6. In Brightspace, add an LTI **link** that launches this tool and set a **custom LTI parameter** (see [Brightspace: register the tool](#brightspace-register-the-tool)) so the shell knows the **Brightspace** URL to pass to **Open quiz`.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port (default `3000`). The reverse proxy forwards to this. |
| `PUBLIC_BASE_URL` | Yes | Public base URL of **this tool** (no trailing slash), e.g. `https://proctor-lti.example.com`. Used to build redirect URLs and to validate the **`target_link_uri`** claim. |
| `PLATFORM_ISSUER` | Yes | Brightspace **issuer** (often your site base URL, no trailing slash). |
| `PLATFORM_OIDC_AUTH_URL` | Yes | OpenID **authorization** endpoint, e.g. `https://<host>/d2l/lti/authenticate` (use the value from the registration). |
| `PLATFORM_JWKS_URI` | Yes | Platform **JWKS** URL, e.g. `https://<host>/d2l/.well-known/jwks`. |
| `LTI_CLIENT_ID` | Yes | LTI 1.3 **client id** for this tool. |
| `LTI_TOKEN_AUDIENCE` | No | If Brightspace issues `id_token` with a different **audience**, set it. Otherwise the tool uses `LTI_CLIENT_ID` as the audience. |
| `ALLOWED_DEPLOYMENT_IDS` | No | Comma-separated deployment GUIDs. If empty, **any** deployment in a valid token is accepted. |
| `DEFAULT_TEST_RUNNER_URL` | No | Absolute `https` URL to open in a new tab if the launch has no **`test_runner_url`** (e.g. a default Brightspace page). |
| `SESSION_SECRET` | Yes | Strong secret; signs short-lived **OIDC state** JWTs (no cookies in this app). |

## Brightspace: register the tool

1. **Settings** → **Manage extensibility** → **LTI Advantage** → register or open the tool.
2. Typical registration fields:

| Brightspace field | Value |
| --- | --- |
| **Domain** | Host of `PUBLIC_BASE_URL` (no path). |
| **Target link / launch URL** | `{PUBLIC_BASE_URL}/lti/launch` |
| **OpenID Connect login URL** | `{PUBLIC_BASE_URL}/lti/login` |
| **Redirect URLs** | `{PUBLIC_BASE_URL}/lti/launch` |
3. Copy from the registration into **`.env`**: **issuer** → `PLATFORM_ISSUER`, **OIDC auth URL** → `PLATFORM_OIDC_AUTH_URL`, **key set URL** → `PLATFORM_JWKS_URI`, **client id** → `LTI_CLIENT_ID`, and optional **audience** → `LTI_TOKEN_AUDIENCE`.
4. Create a **deployment**; optionally restrict the tool to known deployments via **`ALLOWED_DEPLOYMENT_IDS`**.

### Custom parameter for the Brightspace page URL

On the **link** (or deployment), add a custom LTI parameter so the shell receives the full URL to open in the new tab:

| Name | Example |
| --- | --- |
| `test_runner_url` | `https://<your-brightspace-host>/d2l/...` (the quiz or content page) |

The value must be a **fully qualified** `https` URL. If you omit it, set **`DEFAULT_TEST_RUNNER_URL`** in **`.env`**. The `ltiJwt` parser also accepts a camelCase **`testRunnerUrl`** in custom claims, if you configure the platform to send that name.

## How the launch flow works

1. The LMS or Brightspace starts OIDC with **`/lti/login`**, passing `iss`, `login_hint`, `target_link_uri`, `client_id`, and optional `lti_message_hint`, and so on.
2. The tool **redirects** the browser to Brightspace’s `id_token` endpoint and passes a **signed `state` JWT** (HS256) instead of a server session.
3. Brightspace **POST**s to **`/lti/launch`** with `id_token` and `state`. The tool validates **state**, then the **`id_token`**, checks **deployment** (if configured) and that **`target_link_uri`** is exactly **`{PUBLIC_BASE_URL}/lti/launch`**, and reads the quiz URL from **`https://purl.imsglobal.org/spec/lti/claim/custom`**.
4. The tool responds with HTML for the proctor **shell** (and sets **CSP** `frame-ancestors` to Brightspace so the shell can be embedded in the course).

## Shell UI and extension

The shell markup is generated in **`src/server.js`**. Exposed in the page:

- A hidden field **`#lti-test-runner-url`**: the same URL the extension and fallbacks use.
- **`#btn-launch-quiz`**, **`#btn-play`**, **`#btn-pause`**, **`#btn-stop`**, and **`#status`**.

| Button | With extension (recommended) | Without extension (fallback) |
| --- | --- | --- |
| **Open quiz** | Service worker **creates a tab** (and can replace a previously registered quiz tab for the same proctor view). | **`window.open`**; allow **popups** for your tool origin. |
| **Play** | Focus the quiz **tab and window**; clear pause overlay. | **Focus** the `window` reference, if the browser still allows it. |
| **Pause** | Injects a dimming **overlay** on the **quiz** tab. | The shell can only show a **message**; it cannot block input in the other tab. |
| **Stop** | **Closes** the quiz **tab** (`chrome.tabs.remove`). | **`window.close()`** on the same reference only if the browser still treats it as script-closable. |

**LTI in an iframe:** the extension’s content script runs in **`all_frames: true`**. A session key is derived from the **sending** tab and **frame** so a unique quiz tab is tracked per proctor view.

Narrowing **`host_permissions`** in [`extension/manifest.json`](extension/manifest.json) to a single Brightspace host is a good **production** hardening step once you know the exact FQDN. For install steps, file roles, and permissions, see [`extension/README.md`](extension/README.md).

## Optional: `postMessage` channel (owned pages)

If the URL you open is a **page you own**, it can still listen for **`d2l-lti-test-runner-control`**. Brightspace’s **native** quiz does **not** use this channel. See **[`/public/demo-runner.html`](public/demo-runner.html)** (served as static) for a minimal listener. The current shell is optimized for a **separate** Brightspace tab, not the old iframe-embed flow.

## Limitations

- **Brightspace native** quiz: you get **tab focus**, **visual overlay** on **Pause** (not true server pausing), and **close tab** on **Stop** when the extension is used. Timers, autosave, and submission are **not** guaranteed to stop.
- **Pause overlay** is **best-effort**; pages with strict CSP, shadow DOM, or iframes may not match every sub-view.
- **Without the extension**, treat **Pause** / **Stop** on the other tab as **unreliable**.

## Project layout

| Path | Role |
| --- | --- |
| `src/server.js` | Express app, `/lti/login`, `/lti/launch`, proctor **shell** HTML. |
| `src/ltiJwt.js` | `id_token` validation (JWKS, audience, `target_link_uri`, custom `test_runner_url` / `testRunnerUrl`, deployment). |
| `src/oidcState.js` | Sign and verify **state** JWTs. |
| `src/config.js` | **dotenv** + env wiring. |
| `public/demo-runner.html` | Demo **`postMessage`** page (not required for native Brightspace). |
| `extension/README.md` | **Extension** install, files, and troubleshooting. |
| `extension/manifest.json` | Extension **Manifest V3**. |
| `extension/background.js` | Service worker: open/focus/overlay/close; **`chrome.storage.session`**. |
| `extension/content-lti-bridge.js` | Content script: capture-phase **button** handling, status line updates. |

## Troubleshooting

- **`npm` not found** — Install Node LTS, **restart** the terminal, or on Windows use `"C:\Program Files\nodejs\npm.cmd" install`.
- **Launch / audience / issuer errors** — Re-copy values from the Brightspace registration; watch for trailing **spaces** or a wrong **OAuth2 audience**.
- **`target_link_uri` doesn't match** — `PUBLIC_BASE_URL` must match **scheme, host, port, and path** to **`/lti/launch`**, exactly as registered in Brightspace.
- **Deployment rejected** — Add the deployment GUID to **`ALLOWED_DEPLOYMENT_IDS`**, or leave it **empty** while testing.
- **Proctor controls do nothing to the test tab** — **Load the extension**; reload the proctor page after **Load unpacked**. The extension must be **Enabled**.
- **Open quiz** opens a blank or blocked window — In the browser, **allow popups** for the **tool** origin, or use the **extension** path (tab created by the service worker).
- **Status stuck after closing the quiz manually** — With the extension, closing the student’s quiz tab should still broadcast **“Quiz tab was closed”**; if it does not, check that the extension is enabled and the console for errors.
