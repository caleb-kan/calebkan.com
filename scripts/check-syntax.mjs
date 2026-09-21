import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

for (const directory of ["api", "js", "worker", "scripts"]) {
  for (const file of await readdir(directory)) {
    if (/\.m?js$/.test(file)) {
      execFileSync(process.execPath, ["--check", `${directory}/${file}`], {
        stdio: "inherit",
      });
    }
  }
}
