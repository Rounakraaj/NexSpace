import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

function portValue(value, fallback, name) {
  const port = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(true);
      else reject(error);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Timed out while checking port ${port}.`));
    });
  });
}

const services = [
  { name: "WEB", port: portValue(process.env.PORT, 3000, "PORT"), setting: "PORT" },
  { name: "COLLAB", port: portValue(process.env.COLLABORATION_PORT, 1234, "COLLABORATION_PORT"), setting: "COLLABORATION_PORT" },
  { name: "CANVAS", port: portValue(process.env.CANVAS_PORT, 1235, "CANVAS_PORT"), setting: "CANVAS_PORT" },
];

const occupied = [];
for (const service of services) {
  if (!await isPortAvailable(service.port)) occupied.push(service);
}

if (occupied.length) {
  console.error("Cannot start NexSpace development services; these service ports are already in use:");
  for (const { name, port, setting } of occupied) {
    console.error(`  ${name}: port ${port} (stop the existing process or choose another ${setting})`);
  }
  process.exitCode = 1;
} else {
  const concurrentlyCli = fileURLToPath(new URL("../node_modules/concurrently/dist/bin/index.js", import.meta.url));
  const child = spawn(process.execPath, [
    concurrentlyCli,
    "--kill-others",
    "--names", "WEB,CANVAS,COLLAB",
    "--prefix-colors", "blue,magenta,green",
    "next dev",
    "npm run canvas",
    "npm run collab",
  ], { stdio: "inherit", env: process.env, cwd: process.cwd() });

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      if (child.exitCode === null) child.kill(signal);
    });
  }

  child.once("error", (error) => {
    console.error("Could not launch the NexSpace development processes.", error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
