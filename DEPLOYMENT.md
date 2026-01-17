# Deployment Guide

Quick deployment guide for hackathon demo.

## Prerequisites

1. **Turso Database** (free tier)
   ```bash
   # Install Turso CLI
   curl -sSfL https://get.tur.so/install.sh | bash

   # Create database
   turso db create grokathon

   # Get connection URL
   turso db show grokathon --url

   # Create auth token
   turso db tokens create grokathon

   # Your DATABASE_URL will be:
   # libsql://<db-name>-<org>.turso.io?authToken=<token>
   ```

2. **xAI API Key**
   - Get from: https://console.x.ai/

3. **Generate Encryption Key**
   ```bash
   openssl rand -base64 32
   ```

---

## Option 1: Railway + Vercel (Recommended)

### Backend on Railway

1. Push code to GitHub

2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub

3. Select this repo, Railway will auto-detect the config

4. **Set environment variables** in Railway dashboard:
   ```
   DATABASE_URL=libsql://...
   CORS_ORIGIN=https://your-app.vercel.app
   XAI_API_KEY=xai-...
   CREDENTIALS_ENCRYPTION_KEY=<your-32-char-key>
   NODE_ENV=production
   ```

5. **Set root directory** to `/` (monorepo root)

6. Deploy! Note the URL (e.g., `https://grokathon-server.up.railway.app`)

### Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → Add New Project

2. Import your GitHub repo

3. **Configure:**
   - Framework Preset: Vite
   - Root Directory: `apps/web`
   - Build Command: `cd ../.. && pnpm install && pnpm --filter web build`
   - Output Directory: `dist`

4. **Set environment variable:**
   ```
   VITE_SERVER_URL=https://your-railway-url.up.railway.app
   ```

5. Deploy!

### Push Database Schema

```bash
DATABASE_URL="libsql://..." pnpm --filter @grokathon-london-2026/db db:push
```

---

## Option 2: Fly.io (Both services)

### Backend

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login

# Deploy from repo root
fly launch --config fly.toml

# Set secrets
fly secrets set \
  DATABASE_URL="libsql://..." \
  XAI_API_KEY="xai-..." \
  CREDENTIALS_ENCRYPTION_KEY="..." \
  CORS_ORIGIN="https://your-frontend.fly.dev"

# Deploy
fly deploy
```

### Frontend (Static Site on Fly)

```bash
cd apps/web
pnpm build

# Create fly.toml for static site
fly launch --name grokathon-web

# Or use Vercel/Netlify for frontend (easier)
```

---

## Option 3: Docker (Any Platform)

Works with Google Cloud Run, AWS ECS, Azure Container Apps, etc.

```bash
# Build
docker build -t grokathon-server .

# Run locally
docker run -p 3000:3000 \
  -e DATABASE_URL="..." \
  -e XAI_API_KEY="..." \
  -e CREDENTIALS_ENCRYPTION_KEY="..." \
  -e CORS_ORIGIN="http://localhost:3001" \
  grokathon-server

# Push to registry and deploy to your platform
```

---

## Environment Variables Reference

### Backend (Required)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Turso connection string | `libsql://db-org.turso.io?authToken=...` |
| `CORS_ORIGIN` | Frontend URL | `https://myapp.vercel.app` |
| `XAI_API_KEY` | xAI Grok API key | `xai-...` |
| `CREDENTIALS_ENCRYPTION_KEY` | 32+ char secret | `openssl rand -base64 32` |

### Backend (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `development` |
| `PORT` | Server port | `3000` |
| `USE_REAL_RILL` | Use real Rill CLI | `false` |
| `RILL_PROJECT_PATH` | Rill project path | - |

### Frontend (Required)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_SERVER_URL` | Backend API URL | `https://api.myapp.com` |

---

## Quick Checklist

- [ ] Create Turso database
- [ ] Get xAI API key
- [ ] Generate encryption key
- [ ] Deploy backend (Railway/Fly)
- [ ] Deploy frontend (Vercel)
- [ ] Update CORS_ORIGIN to match frontend URL
- [ ] Push database schema
- [ ] Test the app!

---

## Troubleshooting

**CORS errors?**
- Make sure `CORS_ORIGIN` exactly matches your frontend URL (no trailing slash)

**Database connection fails?**
- Verify Turso token is valid: `turso db tokens create <db-name>`
- Check URL format: `libsql://...?authToken=...`

**Build fails on Railway?**
- Check build logs for missing dependencies
- Ensure all workspace packages are listed in the build command

**Agent not responding?**
- Verify `XAI_API_KEY` is set correctly
- Check server logs for API errors
