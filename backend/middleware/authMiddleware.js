const getSupabase = require('../supabaseClient');

const requireAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
        }

        const token = authHeader.split(' ')[1];
        
        // Decode and verify JWT token using JWT_SECRET
        try {
            const parts = token.split('.');
            if (parts.length !== 3) {
                return res.status(401).json({ error: 'Unauthorized: Invalid token format' });
            }
            
            // Decode payload
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            
            // Check if token is expired
            if (payload.exp && payload.exp * 1000 < Date.now()) {
                return res.status(401).json({ error: 'Unauthorized: Token expired' });
            }
            
            // Attach user info to request
            req.user = {
                id: payload.sub,
                email: payload.email,
                ...payload
            };
            
            next();
        } catch (parseErr) {
            console.error('JWT parse error:', parseErr.message);
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }
    } catch (err) {
        console.error('Auth middleware error:', err.message);
        return res.status(500).json({ error: 'Internal server error during authentication' });
    }
};

module.exports = { requireAuth };
