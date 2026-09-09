# Connect Draft-it PRO to Firebase

## 1. Add the web app configuration

Copy `.env.example` to `.env` in this `draft-it` folder. Fill all six `VITE_FIREBASE_*` values using Firebase Console → Project settings → Your apps → Web app. Restart the local development server after changing `.env`.

These values identify your public Firebase web app. Do not put a service-account JSON file, private key, Admin SDK credential, or OAuth client secret in these variables. The application uses the signed-in user's Firebase token and security rules.

## 2. Enable the Firebase services

- Authentication → Sign-in method → enable **Google** and choose the support email.
- Authentication → Settings → Authorized domains → add **localhost**, plus any hostname you later use to open the app.
- Create the default **Cloud Firestore** database.
- Enable **Cloud Storage** and use its exact bucket name for `VITE_FIREBASE_STORAGE_BUCKET`. Firebase may require billing to provision/use this service.

## 3. Publish the security rules

Using Firebase CLI, authenticated to your Firebase account:

```sh
firebase deploy --only firestore:rules,storage --project draft-it-pro
```

Alternatively paste `firestore.rules` and `storage.rules` into their respective Rules editors in Firebase Console and publish them. Do not use public/test-mode rules. Each user's data is under `/users/{uid}/projects/` and accessible only to that user.

## 4. Configure Storage downloads

The app downloads authenticated snapshot/image bytes to keep an offline copy. Apply the supplied CORS file to the exact bucket. Add your deployed origin to `storage.cors.json` when deploying elsewhere.

```sh
gcloud storage buckets update gs://YOUR_STORAGE_BUCKET --cors-file=storage.cors.json
```

## 5. Sign in and verify

1. Open Draft-it and choose **Sign in with Google**. Allow the Google popup; use a regular browser if an embedded browser blocks Google's flow.
2. On the first sign-in on this device, existing guest/local projects are copied to that account once. Other Google accounts receive separate local workspaces.
3. Make an edit and wait for **Synced to Firebase**.
4. Open the app in a second browser, sign in with the same Google account, and verify the project appears.
5. Disconnect the internet, edit locally, then reconnect. Changes should sync again.
6. Edit the same project on two devices offline, then reconnect. Both versions should be retained, with local conflicting edits in a **conflict copy**.

## Storage design and limits

Firestore stores a small per-project manifest with a revision, content hash, and Storage snapshot path. Firebase Storage contains immutable JSON snapshots and separately uploaded, content-addressed storyboard images. Episodes remain inside their parent series snapshot. This preserves the current local-first scene model and avoids Firestore's document-size limit. It is snapshot-based project sync, not simultaneous block-level collaboration.

Changes are saved locally first and debounced before upload. A Firestore transaction prevents blindly overwriting a newer revision. Remote changes arrive through a Firestore listener. Local sync baselines and projects are saved together in account-scoped IndexedDB; backups are account-scoped too. Sign-out does not erase local account data, but another account does not see or upload it through the app. Browser storage is not an encrypted vault.

Automatic backup intervals retain their five browser-local snapshots. Cloud sync is separate from that backup setting and runs after edits while signed in. Remote snapshots are retained; no automatic cloud-history deletion is performed. Failed/racing uploads can leave unused Storage objects; add a retention/cleanup policy before a large production rollout.

**Not verified without your configuration:** real Google OAuth, deployed rules, Storage CORS, and cross-device Firebase traffic. The app stays usable locally until configured.

Official references: [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Storage download/CORS setup](https://firebase.google.com/docs/storage/web/download-files#cors_configuration).
