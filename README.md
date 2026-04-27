# Codex Usage Viewer

A minimal Firefox/Chrome/Edge extension that shows your Codex usage from ChatGPT's analytics page:

`https://chatgpt.com/codex/cloud/settings/analytics#usage`

## Install In Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on...`.
3. Select `/home/smooth/codex-usage/manifest.json`.

Firefox removes temporary add-ons when the browser restarts.

## Install In Chrome Or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Click `Load unpacked`.
4. Select this folder: `/home/smooth/codex-usage`.

## Use

1. Sign in to ChatGPT in the same browser profile.
2. Click the extension icon.
3. Click `Refresh`.

The extension calls ChatGPT's Codex usage endpoint directly:

`https://chatgpt.com/backend-api/wham/usage`

It does not open the analytics page or scrape the rendered UI.

The extension stores the latest parsed usage snapshot locally, so the popup can show the last captured data later.

## Permissions

- `storage`: save the latest parsed usage snapshot locally.
- `https://chatgpt.com/*`: call ChatGPT's session and Codex usage endpoints.

## Security Notes

ChatGPT's visible analytics URL returns generic app data, not reliable usage JSON. The current useful endpoint is `/backend-api/wham/usage`.

The extension uses `/api/auth/session` to read the current ChatGPT access token, then calls the Codex usage endpoint with that bearer token. It stores only the latest parsed usage snapshot locally.

The extension does not request browser cookie access. Cookies are only sent by the browser as part of authenticated requests to `chatgpt.com`.

Do not commit HAR files or screenshots containing tokens, cookies, account IDs, or email addresses.
