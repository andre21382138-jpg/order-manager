module.exports = {
  apps: [
    {
      name: "naver-proxy",
      script: "proxy.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "200M",
      env: { NODE_ENV: "production" },
      error_file: "./naver-proxy.err.log",
      out_file: "./naver-proxy.out.log",
      time: true,
    },
    {
      name: "naver-tunnel",
      script: "cloudflared",
      args: "tunnel --url http://127.0.0.1:3002 --protocol http2",
      autorestart: true,
      max_memory_restart: "200M",
      error_file: "./naver-tunnel.err.log",
      out_file: "./naver-tunnel.out.log",
      time: true,
    },
  ],
};
