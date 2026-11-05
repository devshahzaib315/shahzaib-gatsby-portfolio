# Shahzaib Room

Premium dark real-time chat room with one-time activation codes, owner-only code generation, and a mobile-friendly PWA-ready layout.

## Important: one-time setup

This source code is complete, but it needs your own Supabase project to store messages and verify codes. Do not put the Supabase **service role key** in Vercel or frontend files.

### 1. Create a free Supabase project
1. Open https://supabase.com and create a project.
2. In **Project Settings → API**, copy the Project URL and the publishable/anon key.
3. In **Authentication → Providers → Anonymous**, enable Anonymous Sign-ins.
4. Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it.

### 2. Deploy the two Edge Functions
Install the Supabase CLI, sign in, and link your project:
```bash
npm install
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set ADMIN_PASSWORD="choose-a-long-private-password"
npx supabase functions deploy admin-codes
npx supabase functions deploy redeem-code
```
The Supabase CLI deploys functions with the project's service role key available server-side. Never expose that key in the browser.

### 3. Run locally
```bash
npm install
cp .env.example .env
```
Put your own Supabase URL and anon/publishable key in `.env`, then:
```bash
npm run dev
```
Open the local URL shown by Vite.

### 4. Deploy to Vercel
1. Push this folder to a GitHub repository.
2. Import the repository into https://vercel.com.
3. Add these Environment Variables in Vercel Project Settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. If you change environment variables, redeploy.

### 5. Generate your first invitation
Open the deployed site, click the shield icon in the top-right, enter the `ADMIN_PASSWORD` you set in Supabase Edge Function secrets, and click **Generate one-time code**. Copy the code and privately send it to one person. A code can only be redeemed once.

## Features
- Invitation-only entry screen and one-time activation code redemption
- Owner-only code generation through a server-side Edge Function
- Realtime group messages and member list
- Responsive premium dark/glass interface
- Chat messages are limited to 2,000 characters

## Security notes
- The admin password is checked only inside the Edge Function; it is not stored in frontend source.
- Activation codes are stored as SHA-256 hashes and atomically consumed once.
- RLS protects messages and member records; users must be authenticated and activated.
- Anyone with a valid unused invite can join. Share invitations privately.
- This starter is intended for a small private room. For a public production community, add rate limiting, moderation/reporting, CAPTCHA or invite expiration, and stronger admin authentication.
- Anonymous auth must be enabled in Supabase. If anonymous sign-ins are disabled, activation cannot begin.
