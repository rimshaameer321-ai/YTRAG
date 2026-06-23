// supabaseClient.ts
// Purpose: Supabase client ek hi jagah banate hain, taake poore app mein
// (Login, Signup, Logout, session check) sab isi ek client ko use karein.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL as string;
const supabaseKey = process.env.REACT_APP_SUPABASE_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL ya Key .env mein missing hai (REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_KEY)');
}

export const supabase = createClient(supabaseUrl, supabaseKey);