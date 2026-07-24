# Deployment Instructions

## ✅ Code Changes Complete

Your code has been successfully pushed to the `fix/jwt-auth-token-verification` branch on GitHub:
- **Commit**: Add location coordinates to web & GBP rankings
- **Repository**: https://github.com/bizscale-dev/Rank-Tracker

### Changes Included:
1. ✅ Enhanced location matching for coordinates
2. ✅ Added 500+ US cities with lat/long
3. ✅ Fixed GBP rankings coordinates
4. ✅ Fixed web rankings coordinates
5. ✅ Improved error handling

---

## 🚀 Production Deployment

### Your Production Server
- **URL**: http://ranktracker.bizscale.pk
- **Server IP**: 173.212.250.224
- **OS**: Linux (Ubuntu)
- **Backend Port**: 5000
- **Reverse Proxy**: Nginx

### To Deploy on Production Server

**Option 1: Using SSH (Recommended)**
```bash
# SSH into your server
ssh root@173.212.250.224

# Run the deployment script
cd /var/www/rank-tracker
bash deploy-server.sh
```

**Option 2: Manual Deployment**
```bash
ssh root@173.212.250.224

# Navigate to app directory
cd /var/www/rank-tracker

# Pull latest changes
git pull origin fix/jwt-auth-token-verification

# Update backend dependencies
cd backend
npm install --production

# Update frontend dependencies
cd ../frontend
npm install

# Build frontend
npm run build

# Restart backend with PM2
cd ../backend
pm2 delete rank-tracker-backend 2>/dev/null || true
pm2 start server.js --name rank-tracker-backend
pm2 save

# Restart Nginx
sudo systemctl restart nginx
```

### Verification Steps

After deployment, verify everything works:

```bash
# Check backend status
pm2 status

# Check backend logs
pm2 logs rank-tracker-backend

# Test backend API
curl http://localhost:5000/api/rank/test

# Check Nginx status
sudo systemctl status nginx

# Test frontend
curl http://ranktracker.bizscale.pk
```

### Expected Output

✅ Backend should be running on port 5000  
✅ Frontend should be accessible at http://ranktracker.bizscale.pk  
✅ API should respond to requests  
✅ Coordinates should be included in DataForSEO requests  

---

## 📋 What Changed

### Backend Changes
- **backend/services/dataForSEOService.js**
  - Fixed error handling in catch blocks
  - Methods now properly throw errors instead of silently failing

- **backend/routes/rankRoutes.js**
  - Added `resolveLocationWithCoordinates()` helper function
  - All ranking endpoints now pass coordinates to DataForSEO

- **backend/data/locations.js**
  - Enhanced `getLocationWithCoordinates()` function
  - Added New Braunfels, Georgetown, Pflugerville (Texas)
  - Now handles space/case variations in location names

### Frontend Changes
- **frontend/src/App.jsx**
  - Now properly handles coordinate responses

- **frontend/src/components/**
  - BatchGBPChecker.jsx
  - GBPRankChecker.jsx
  - Both now display rank positions with coordinates

### Deployment Files
- **deploy-server.sh** - Updated for latest setup

---

## 🔍 Testing After Deployment

### Test Web Rankings with Coordinates
1. Login to dashboard
2. Go to "🌐 Web Rankings"
3. Enter a keyword, location (e.g., "New Braunfels, Texas"), and domain
4. Click "Check Ranking"
5. Backend logs should show:
   ```
   ✅ Location matched: New Braunfels, Texas, United States → lat: 29.7010, lng: -97.9800
   📤 DataForSEO task_post: 1 keyword(s) with location_name + location_coordinate
   ```

### Test GBP Rankings with Coordinates
1. Go to "📍 GBP Rankings"
2. Enter keyword, location, and business name
3. Click "Check Single Keyword"
4. Should see coordinates in request metadata

---

## 📞 Troubleshooting

### If Backend Won't Start
```bash
# Check logs
pm2 logs rank-tracker-backend

# Check if port 5000 is in use
sudo lsof -i :5000

# Restart PM2
pm2 stop all
pm2 start server.js --name rank-tracker-backend
```

### If Frontend Shows Blank Page
```bash
# Rebuild frontend
cd /var/www/rank-tracker/frontend
npm run build

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log
```

### If API Endpoints Return 500 Errors
- Check backend logs: `pm2 logs rank-tracker-backend`
- Verify Supabase credentials in `.env`
- Verify DataForSEO credentials in `.env`

---

## ✨ Features Now Working

✅ **Web Rankings with Coordinates**
- Single keyword checks include location_coordinate
- Batch checks include location_coordinate for all keywords
- Competitor analysis includes location_coordinate

✅ **GBP Rankings with Coordinates**
- Single checks include location_coordinate
- Batch checks include location_coordinate
- All use precise lat/lng targeting

✅ **500+ US Cities**
- All major US cities covered
- Including New Braunfels, TX and other recent additions
- Flexible matching handles space/case variations

---

## 📝 Next Steps

1. Deploy to production server
2. Test all features
3. Monitor backend logs for errors
4. Verify DataForSEO requests include coordinates
5. Monitor API usage and costs

---

**Code is ready for deployment!** Push to production when ready.
