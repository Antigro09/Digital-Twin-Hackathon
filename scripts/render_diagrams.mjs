import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = join(repository, "docs", "enterprise-digital-twin", "diagrams");
const outputDirectory = join(sourceDirectory, "generated");
const executable = process.execPath;
const cli = join(repository, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");

mkdirSync(outputDirectory, { recursive: true });
for (const existing of readdirSync(outputDirectory)) {
  if (existing.endsWith(".svg") || existing.endsWith(".png")) {
    rmSync(join(outputDirectory, existing));
  }
}

const sources = readdirSync(sourceDirectory)
  .filter((name) => name.endsWith(".mmd"))
  .sort();

if (sources.length === 0) {
  throw new Error("No Mermaid sources were found.");
}

for (const sourceName of sources) {
  const stem = sourceName.slice(0, -4);
  const source = join(sourceDirectory, sourceName);
  const common = [
    "-i", source,
    "-c", join(repository, "mermaid-config.json"),
    "-b", "transparent",
    "--quiet"
  ];
  for (const extension of ["svg", "png"]) {
    const output = join(outputDirectory, `${stem}.${extension}`);
    const args = [cli, ...common, "-o", output];
    if (extension === "png") {
      args.push("-s", "2");
    }
    const result = spawnSync(executable, args, {
      cwd: repository,
      stdio: "inherit"
    });
    if (result.status !== 0) {
      throw new Error(`Mermaid rendering failed for ${sourceName} (${extension}).`);
    }
  }
}

console.log(`Rendered ${sources.length} Mermaid sources to SVG and PNG.`);
