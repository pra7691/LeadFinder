import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

function workspaceRoot() {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", ".."),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, "pnpm-workspace.yaml"))) ?? process.cwd();
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function saveExportFile(filename: string, content: string | Buffer | Uint8Array) {
  const exportDir = path.join(workspaceRoot(), "exports");
  await mkdir(exportDir, { recursive: true });

  const safeName = safeFilename(filename);
  const filePath = path.join(exportDir, safeName);
  await writeFile(filePath, content);

  return {
    filename: safeName,
    path: filePath,
    relativePath: `exports/${safeName}`,
  };
}
