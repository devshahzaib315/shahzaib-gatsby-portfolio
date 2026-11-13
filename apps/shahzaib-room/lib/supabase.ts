import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Publishable keys are designed for public client apps. Database access must
// still be protected by Supabase RLS. Never use a service_role/secret key here.
const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://qvbrmbtuqvoksciauswd.supabase.co';
const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_6xxRRbYkN763pPdYIm8HFw_2StIOiC8';

export const supabase = createClient(url, publishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
