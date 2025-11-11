#!/bin/bash
set -e

echo "🔧 Setting up AlwaysData environment..."

ssh reru@ssh-reru.alwaysdata.net << 'EOF'
# Create directory structure
mkdir -p ~/www/nc-ranking
cd ~/www/nc-ranking

# Install PM2 globally
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << 'EOL'
module.exports = {
  apps: [{
    name: 'nightcrows-api',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024'
  }]
};
EOL

# Create logs directory
mkdir -p logs

# Create .env file
cat > .env << 'EOL'
NODE_ENV=production
PORT=3000
GIPHY_API_KEY=your_giphy_api_key_here
NC_API_KEY=nDZRLdB83mDw8Gw1IThvg
EOL

echo "✅ Setup complete! Don't forget to update .env with your actual API keys"
EOF