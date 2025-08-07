module.exports = {
  apps: [{
    name: 'wh-bot',
    script: 'src/server-refactored.js',
    cwd: '/home/forge/wh.sagessia.com',
    interpreter: '/home/forge/.nvm/versions/node/v20.19.4/bin/node',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/home/forge/wh.sagessia.com/logs/error.log',
    out_file: '/home/forge/wh.sagessia.com/logs/out.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};