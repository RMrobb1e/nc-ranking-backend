#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# Build the project
echo "📦 Building project..."
npm run build

# Copy files to AlwaysData
echo "📤 Uploading files..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'src' \
  --exclude '*.log' \
  --exclude '.wrangler' \
  --exclude '.github' \
  --exclude 'scripts' \
  --exclude '.eslintrc' \
  --exclude '.gitignore' \
  --exclude '.nvmrc' \
  --exclude '.prettierrc' \
  --exclude 'README.md' \
  --exclude 'tsconfig.json' \
  --exclude 'worker-configuration.d.ts' \
  --exclude 'wrangler.jsonc' \
  ./ reru@ssh-reru.alwaysdata.net:~/www/nc-ranking/

# Install dependencies and restart on server
echo "🔄 Installing dependencies on server..."
ssh reru@ssh-reru.alwaysdata.net << 'EOF'
cd ~/www/nc-ranking
npm ci --only=production
pm2 restart nightcrows-api || pm2 start dist/index.js --name nightcrows-api
EOF

echo "✅ Deployment complete!"