import { spawn } from "node:child_process";

const hostname = process.env.NEXT_DEV_HOSTNAME?.trim() || "localhost";
const port = process.env.PORT?.trim() || "3000";
const pythonHost = process.env.PYTHON_API_HOST?.trim() || "127.0.0.1";
const pythonPort = process.env.PYTHON_API_PORT?.trim() || "8000";
const pythonReloadArgs =
  process.env.PYTHON_RELOAD === "0" ? [] : ["--reload", "--reload-dir", "backend"];
const apiOnly = process.argv.includes("--api-only");
const services = [
  {
    name: "FastAPI",
    command: "uv",
    args: [
      "run",
      "--project",
      "backend",
      "uvicorn",
      "app.main:app",
      ...pythonReloadArgs,
      "--app-dir",
      "backend",
      "--host",
      pythonHost,
      "--port",
      pythonPort,
    ],
  },
  ...(!apiOnly ? [{
    name: "Next.js",
    command: "pnpm",
    args: ["exec", "next", "dev", "--hostname", hostname, "--port", port],
  }] : []),
];

const children = [];
let shuttingDown = false;

for (const service of services) {
  const child = spawn(service.command, service.args, {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
  });
  children.push({ ...service, child });

  child.on("error", (error) => {
    process.stderr.write(`${service.name} no pudo iniciar: ${error.message}\n`);
    stop("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      const reason = signal ? `señal ${signal}` : `código ${code ?? "desconocido"}`;
      process.stderr.write(`${service.name} terminó inesperadamente (${reason}).\n`);
      stop("SIGTERM", code ?? 1);
    }
  });
}

process.on("SIGINT", () => stop("SIGINT", 0));
process.on("SIGTERM", () => stop("SIGTERM", 0));

function stop(signal, exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }

  const forceStop = setTimeout(() => {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 5_000);
  forceStop.unref();
}
