module.exports = {
  apps: [
    {
      name: "nightcrows-api",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        GIPHY_API_KEY: process.env.GIPHY_API_KEY,
        NC_API_KEY: process.env.NC_API_KEY,
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=1024",
      watch: false,
      ignore_watch: ["node_modules", "logs"],
      restart_delay: 1000,
    },
  ],
};
