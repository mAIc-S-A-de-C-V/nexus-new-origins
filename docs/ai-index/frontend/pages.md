# `src/pages/`

3 standalone authentication pages used outside `AuthGate`.

## `LoginPage.tsx` (11.5KB)

- Two-step flow: email → password → (optional) TOTP.
- Calls `useAuth().login(email, password)`.
- "Remember me" UI-only.
- OIDC buttons (Google, Okta, Azure) when env-configured.
- Dark theme (`#1B2333` background).

**When to edit:** add SSO buttons, change validation, modify branding.

## `ChangePasswordPage.tsx` (5.9KB)

- Triggered when `currentUser.mustChangePassword === true`.
- Validates min 6 chars + match.
- Calls `changePassword(userId, newPassword)`.
- Auto-logout after success.

**When to edit:** tighten password rules, add complexity feedback.

## `SSOCallbackPage.tsx` (3.0KB)

- Path `/auth/callback?token=<JWT>&provider=<provider>`.
- Calls `useAuthStore().handleOIDCCallback(token)` to decode JWT and set state.
- Cleans URL, redirects home.
- Shows loading → success/error.

**When to edit:** add new SSO provider, change callback URL, custom error messages.
