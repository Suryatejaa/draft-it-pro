# Draft-it PRO — local demo

A connected screenwriting and pre-production workspace. Scenes have stable IDs; cards and the screenplay share a single ordered scene list. Storyboard panels are the source for the shot list.

## Run locally

```sh
npm install
npm run dev
```

Open the local address printed by the server. The app uses React, TypeScript, Vinext (Next.js-compatible), Tiptap / ProseMirror, and React PDF.

## Included

- Three sample projects and project creation with nine format options
- Story overview, character bible, locations, and automatic scene appearances
- Scene cards with drag ordering, accessible move buttons, and custom columns
- Semantic screenplay paragraphs, Enter/Tab shortcuts, slash commands, location suggestions, scene navigation and metadata
- Storyboard image uploads, drag/drop and paste; panel editing updates shot-list entries
- Browser-local IndexedDB autosave, including images
- PDF, Fountain, plain text, shot-list CSV, and complete JSON backup exports
- Responsive layouts with a mobile navigation drawer

## Demo boundaries

This is a local demonstration, not the production release. Firebase Google authentication and cloud sync are implemented and activate after the configuration in FIREBASE_SETUP.md. Live Firebase verification requires your project settings. Collaboration, production breakdowns, scheduling, revision history, and FDX remain deferred. Images are limited to 8 MB each. Browser storage can be cleared by browser settings; export backups for safekeeping. PDF export uses a dedicated US Letter / Courier renderer with a fixed-line pagination algorithm and dialogue continuation markers, but needs more production-layout work for all screenplay edge cases. The editor operates one scene at a time; use Add scene to create another scene.

## Checks

```sh
npx tsc --noEmit
node --experimental-strip-types tests/project.test.mjs
npm run build
```

The model checks cover reordering, stable storyboard links, character/location reconciliation, and cleanup of partial auto-created names. PDF rendering and long-dialogue continuation were also checked. Browser interaction and WebMCP runtime verification were not performed.

## Firebase setup

See [FIREBASE_SETUP.md](FIREBASE_SETUP.md) and fill `.env` using `.env.example`. Google sign-in syncs local projects to account-scoped Firestore manifests and Storage snapshots/images. Local changes persist offline; conflicting versions are retained as copies.

Additional local verification: `node --experimental-strip-types tests/firebase-local.test.mjs`.
