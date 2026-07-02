const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SERVICE_ROLE_SECRET;

if (!supabaseServiceKey) {
    console.error('❌ Error: SUPABASE_SERVICE_KEY not found in .env');
    console.error('You need to add your Service Role Secret key to .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function resetPassword(email, newPassword) {
    try {
        console.log(`🔄 Fetching user with email: ${email}`);
        
        // Get the user by email
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        
        if (listError) throw listError;
        
        const user = users.find(u => u.email === email);
        
        if (!user) {
            console.error(`❌ User not found with email: ${email}`);
            return;
        }
        
        console.log(`✓ Found user: ${user.id}`);
        
        // Update password
        const { data, error } = await supabase.auth.admin.updateUserById(
            user.id,
            { password: newPassword }
        );
        
        if (error) throw error;
        
        console.log(`✅ Password updated successfully for ${email}`);
        console.log(`User ID: ${user.id}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Get email and password from command line arguments
const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
    console.log('Usage: node resetPassword.js <email> <newPassword>');
    console.log('Example: node resetPassword.js usman@businessupscalers.com rankBizTrack!#@');
    process.exit(1);
}

resetPassword(email, password);
