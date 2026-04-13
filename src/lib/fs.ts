import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
}

export async function writeBinaryFile(filePath: string, content: ArrayBuffer): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  await writeFile(filePath, Buffer.from(content));
}

export function resolveChatopsPath(root: string, ...parts: string[]): string {
  return path.resolve(root, ...parts);
}
