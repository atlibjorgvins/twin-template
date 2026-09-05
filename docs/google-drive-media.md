# Storing images in Google Drive

Twin can keep images in a **Twin** folder in your own Google Drive instead of
in the database or only on the device. Rows stay in your vault; images live in
your Drive and sync to every device you connect. Twin uses the **drive.file**
scope — it can only see and touch files it created, never the rest of your
Drive.

The image you see is served from a small on-device cache; Drive is the
durable copy. A newly connected device fills its cache from Drive in the
background, so pictures appear shortly after first load.

## One-time Google setup (only you can do this)

The OAuth **client ID** is public config (not a secret), but only you can
create it against your Google account.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and
   create (or pick) a project.
2. **Enable the Drive API**: APIs & Services → Library → *Google Drive API* →
   Enable.
3. **Configure the OAuth consent screen** (External is fine for personal use):
   add your Google account as a Test user, and add the scope
   `https://www.googleapis.com/auth/drive.file`.
4. **Create an OAuth client ID**: APIs & Services → Credentials → *Create
   credentials* → *OAuth client ID* → **Web application**.
   - Under **Authorized JavaScript origins** add the origins twin runs on:
     - the desktop app: `http://localhost` and `tauri://localhost`
     - a web deployment: your site's origin (e.g. `https://twin.example.com`)
   - Save, and copy the **Client ID** (ends in `.apps.googleusercontent.com`).

## Connect twin

1. Settings → Storage → **Images & files** → choose **Google Drive**.
2. Paste the client ID and click **Connect Google Drive**. Google's own
   window opens; approve the `drive.file` access.
3. Click **Apply**. From now on, new image uploads go to the *Twin* folder in
   your Drive.

## Notes & limits

- **Session length**: Google access tokens last about an hour. When one
  expires, reconnect from Settings → Storage (twin tells you when). Persistent
  background refresh is a later addition.
- **Existing images**: switching to Drive doesn't move images already stored
  elsewhere; it changes where *new* uploads go. Re-upload to migrate one.
- **Scope**: `drive.file` means twin never has access to your other Drive
  files — only the ones it creates in the Twin folder.
