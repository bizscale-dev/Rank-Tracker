#!/bin/bash

# Server Deployment Script for Rank Tracker
# Run this on your server: bash deploy-server.sh

set -e

echo "🚀 Starting deployment..."

# Update system
echo "📦 Updating system packages..."
apt-get update
apt-get upgrade -y

# Install Node.js (using NodeSource)
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Git
echo "📦 Installing Git..."
apt-get install -y git

# Install PM2 globally
echo "📦 Installing PM2..."
npm install -g pm2

# Install Nginx
echo "📦 Installing Nginx..."
apt-get install -y nginx

# Create app directory
echo "📁 Creating app directory..."
mkdir -p /var/www/rank-tracker
cd /var/www/rank-tracker

# Clone repository
echo "📥 Cloning repository..."
if [ -d ".git" ]; then
    echo "Repository exists, pulling latest changes..."
    git pull
else
    git clone https://github.com/bizscale-dev/Rank-Tracker.git .
fi

# Setup Backend
echo "🔧 Setting up backend..."
cd /var/www/rank-tracker/backend
npm install --production

# Create backend .env file
cat > .env << 'EOF'
# DataForSEO API Credentials
DATAFORSEO_LOGIN=ayeshaasghar@businessupscalers.com
DATAFORSEO_PASSWORD=6970959a0931a727

# Server Config
PORT=5000
NODE_ENV=production

# Frontend URL (for CORS)
FRONTEND_URL=http://173.212.250.224

# Supabase
SUPABASE_URL=https://moaywhuurlelsptpdlql.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vYXl3aHV1cmxlbHNwdHBkbHFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTI5MzksImV4cCI6MjA4ODEyODkzOX0.OnjL4SMbSTy_Xl8tMThNfNb2HAEkzqXmDCG5NnKxBeI
EOF

# Setup Frontend
echo "🔧 Setting up frontend..."
cd /var/www/rank-tracker/frontend
npm install

# Create frontend .env file
cat > .env << 'EOF'
VITE_SUPABASE_URL=https://moaywhuurlelsptpdlql.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vYXl3aHV1cmxlbHNwdHBkbHFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTI5MzksImV4cCI6MjA4ODEyODkzOX0.OnjL4SMbSTy_Xl8tMThNfNb2HAEkzqXmDCG5NnKxBeI
VITE_API_URL=http://173.212.250.224:5000/api
EOF

# Build frontend
echo "🏗️ Building frontend..."
npm run build

# Start backend with PM2
echo "🚀 Starting backend with PM2..."
cd /var/www/rank-tracker/backend
pm2 delete rank-tracker-backend 2>/dev/null || true
pm2 start server.js --name rank-tracker-backend
pm2 save
pm2 startup

# Configure Nginx
echo "🔧 Configuring Nginx..."
cat > /etc/nginx/sites-available/rank-tracker << 'EOF'
server {
    listen 80;
    server_name 173.212.250.224;

    # Frontend
    location / {
        root /var/www/rank-tracker/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/rank-tracker /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and restart Nginx
echo "🔄 Restarting Nginx..."
nginx -t
systemctl restart nginx

echo "✅ Deployment complete!"
echo "🌐 Frontend: http://173.212.250.224"
echo "🔌 Backend: http://173.212.250.224:5000"
echo ""
echo "📊 Check backend status: pm2 status"
echo "📝 View backend logs: pm2 logs rank-tracker-backend"
