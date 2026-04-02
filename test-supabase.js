import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://pjlhbmfgqjrwpurcgaxa.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqbGhibWZncWpyd3B1cmNnYXhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxNjUxNTUsImV4cCI6MjA2NDc0MTE1NX0.9GtfKsZ2WEsRfTJWV-O1TQBXFGSe1Bk86x8uIp3Pmaw');
async function test() {
    const { data, error } = await supabase.from('n8n_chat_histories').select('*').limit(1);
    console.log('SELECT:', { error, length: data?.length });

    const { data: iData, error: iError } = await supabase.from('n8n_chat_histories').upsert({
        session_id: 'test_cache_123',
        message: { test: true }
    }).select();
    console.log('UPSERT:', { iError, id: iData?.[0]?.id });
    process.exit(0);
}
test();
