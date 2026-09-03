// Copies backend/.env.example -> backend/.env and frontend/.env.example -> frontend/.env
// if they don't already exist. Also generates a random JWT_SECRET for the backend
// so the platform is secure-by-default even for a quick local run.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureEnv(dir) {
  const examplePath = path.join(dir, ".env.example");
  const envPath = path.join(dir, ".env");
  if (!fs.existsSync(examplePath)) return;
  if (fs.existsSync(envPath)) {
    console.log(`✓ ${path.relative(process.cwd(), envPath)} already exists — leaving it untouched.`);
    return;
  }
  let content = fs.readFileSync(examplePath, "utf8");
  if (content.includes("JWT_SECRET=replace-this-in-production")) {
    content = content.replace("JWT_SECRET=replace-this-in-production", `JWT_SECRET=${crypto.randomBytes(32).toString("hex")}`);
  }
  fs.writeFileSync(envPath, content);
  console.log(`✓ Created ${path.relative(process.cwd(), envPath)}`);
}

ensureEnv(path.join(__dirname, "..", "backend"));
ensureEnv(path.join(__dirname, "..", "frontend"));

console.log("\nEnvironment files are ready. Review backend/.env and frontend/.env before deploying.\n");
