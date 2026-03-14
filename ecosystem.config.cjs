module.exports = {
  apps: [
    // --- Next.js (site web) ---
    {
      name: "flowdatagouv",
      script: ".next/standalone/server.js",
      instances: 2,
      exec_mode: "cluster",
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      kill_timeout: 5000,
      listen_timeout: 10000,
      error_file: "/var/log/flowdatagouv/error.log",
      out_file: "/var/log/flowdatagouv/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    // --- MCP Server (Streamable HTTP) ---
    {
      name: "flowdatagouv-mcp",
      script: "mcp/dist/http.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        MCP_PORT: 8000,
        FLOWDATA_URL: "http://localhost:3000",
        MCP_LOG_FILE: "/var/log/flowdatagouv/mcp-tools.ndjson",
      },
      kill_timeout: 5000,
      error_file: "/var/log/flowdatagouv/mcp-error.log",
      out_file: "/var/log/flowdatagouv/mcp-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
