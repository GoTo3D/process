module.exports = {
  apps: [
    {
      name: "PROCESS",
      script: "./src/processQueue.js",
      instances: 1,  // per code AMQP spesso 1 è sufficiente
      autorestart: true,
      max_memory_restart: "500M",
      max_restarts: 10,
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
    }
  ]
}
