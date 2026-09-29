# YouTube publishing setup (owner steps)

These steps are for the owner. CLAUDE.md requires them to be done by hand: agents do not create or configure platform developer apps. Until they are done, `PUBLISH_MODE=dry` (the default) is the only mode that works. No credentials exist yet.

Google Cloud Console menu names change often. As of 2026 the OAuth screens are under **Google Auth Platform**, which has the sections *Branding*, *Audience*, *Clients* and *Data access*. On older consoles the same settings are under **APIs & Services → OAuth consent screen / Credentials**.

## 1. Create the Google Cloud project
1. Go to https://console.cloud.google.com/ and sign in with the Google account that owns the **test channel**. Using a separate test channel is recommended.
2. Open the project picker and choose **New project**. Name it `statreel` (or anything else). You don't need an organization.
3. Write down the **project number** (Dashboard → Project info). You'll need it for the audit form.

## 2. Enable the APIs
Go to **APIs & Services → Library** and enable:
- **YouTube Data API v3**
- **YouTube Analytics API**

## 3. Configure the consent screen
1. Open **Google Auth Platform → Branding** (older consoles: *OAuth consent screen*). Set the app name to `StatReel`, the support email to your address, and the developer contact to your address.
2. Under **Audience**, choose the user type **External**. The publishing status stays **Testing**.
3. Under **Audience → Test users**, choose **Add users** and add the Google account that owns the test channel.
4. Under **Data access → Add or remove scopes**, add:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.force-ssl`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`

> While the app is in **Testing**, Google's refresh tokens **expire after 7 days**. When StatReel reports `invalid_grant`, run the connect step again. Publishing or verifying the app removes this limit. Decide on that together with the audit in step 6.

## 4. Create the OAuth client (Desktop app)
1. Go to **Google Auth Platform → Clients → Create client** (older consoles: *Credentials → Create credentials → OAuth client ID*).
2. Set the application type to **Desktop app** and the name to `statreel-desktop`.
3. Choose **Download JSON**. The file contains `{"installed": {"client_id": …, "client_secret": …}}`.
4. Save it as **`.statreel/google-oauth-client.json`** in the repo root. `.statreel/` is already listed in `.gitignore`, so never commit the file or paste its contents anywhere.

You don't need to register a redirect URI. Desktop clients accept `http://127.0.0.1:<any port>` loopback redirects, and StatReel picks a free port at connect time.

## 5. Connect (first token)
When the connect step is wired into the Studio or CLI, it runs `LoopbackOAuth.authorize()`:
- your browser opens Google's consent page. Sign in as the test-channel account and accept the "unverified app" warning, which is expected in Testing.
- StatReel receives the code on `http://127.0.0.1:<port>`, exchanges it using PKCE, and stores the token in the OS keychain through the SecretStore.

After that, `pnpm e2e:live` uploads **private** videos to the test channel. It then checks the upload through the API and deletes it.

## 6. Submit the API audit (removes the forced-private restriction)
Uploads from an unaudited project created after 2020-07-28 are **forced to private**. That's fine for v1, because StatReel uploads private anyway. Public publishing (after the owner approves it) needs the audit, so start it early, because it can take weeks.

1. Open the **YouTube Data API Services Audit and Quota Extension Form**: https://support.google.com/youtube/contact/yt_api_form
2. Choose the option *compliance audit* (the request for additional quota is optional; the default quota covers about 20 live e2e runs a day).
3. Have ready: organization or individual details, the app name, a website or access URL, **privacy policy and terms of service URLs** (a simple hosted page is enough, but they must exist), the Google Cloud **project number**, the API endpoints used (videos.insert, captions.insert/list, videos.list/delete, YouTube Analytics reports.query), screenshots of the OAuth flow and the upload UI, and a demo account or video if asked.
4. The review checks your use against the YouTube API Services Terms and Developer Policies. Keep the confirmation email in `docs/` (without any secrets).

## Where StatReel looks

| What | Where |
|---|---|
| OAuth client JSON | `.statreel/google-oauth-client.json` (constant `DEFAULT_CLIENT_JSON`) |
| Tokens | OS keychain via the injected `SecretStore`, key `google-oauth-token:youtube` |
| Mode switch | `PUBLISH_MODE=dry` (default, no network) or `live` |
| Dry-run request plan | the `planFile` path passed to `new YouTubeClient({ planFile })` |
