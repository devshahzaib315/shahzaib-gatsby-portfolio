# SHAHZAIB-ROOM (Native Android)

A real React Native + Expo Android application — not a WebView wrapper.

## Shared backend

- Supabase project: `qvbrmbtuqvoksciauswd`
- Uses the same Supabase Auth, Postgres and Realtime data as the website.
- Client uses the project's publishable key only. Never put a service-role/secret key in a mobile app.

## Included native features

- Pink glass-style sign-in screen using the shared Supabase account system.
- Persistent login session and sign out.
- Live room message feed backed by the existing `messages` table.
- Realtime message and reaction refresh.
- Send text messages, reply to messages, react with the room's 12 supported emoji reactions.
- Delete your own messages where the existing Supabase policies permit it.
- Ban-state check using `room_members`.

## Android identity

- App name: SHAHZAIB-ROOM
- Package: `com.shahzaibroom.app`

## Build

A GitHub Actions workflow at `.github/workflows/android-apk.yml` builds a release APK on pushes to this branch and uploads it as the `SHAHZAIB-ROOM-android-apk` artifact. The workflow can also be started manually from GitHub Actions.

## Notes

The app uses the existing database and security policies. Operations that are not allowed by the project's current Row Level Security policies will be rejected by Supabase; no privileged key is embedded in the app.
