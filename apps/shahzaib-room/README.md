# SHAHZAIB-ROOM (Native Android)

This is a real React Native + Expo Android app. It is **not** a WebView wrapper.

## Shared backend

The app connects to the existing Shahzaib Room Supabase project:
- Project ref: `qvbrmbtuqvoksciauswd`
- Website and Android app use the same Supabase Auth, Postgres, Storage and Realtime backend.
- Never put a Supabase service-role/secret key in this app. Use only the project publishable key.

## Setup

1. Copy `.env.example` to `.env`.
2. Add the project's publishable key as `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Run `npm install` in this directory.
4. Run `npx expo install react-native-url-polyfill` (required by Supabase JS in React Native).
5. Run `npx expo start` to launch the native development app.

## Android package

- Display name: SHAHZAIB-ROOM
- Application ID: `com.shahzaibroom.app`

## Current milestone

Native app scaffold, pink premium login UI, persistent Supabase session and email/password sign-in. Existing website's username/activation-code onboarding and chat feature parity must be ported and tested in subsequent milestones before a production APK is released.
