import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { AgentFrontmatterSchema, type AgentFrontmatter } from "./types.js";

export interface ParsedAgentFile {
  frontmatter: AgentFrontmatter;
  body: string;
}

export async function parseAgentFile(path: string): Promise<ParsedAgentFile> {
  const raw = await readFile(path, "utf8");
  const { data, content } = matter(raw);
  const frontmatter = AgentFrontmatterSchema.parse(data);
  return { frontmatter, body: content.trim() };
}
