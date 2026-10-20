import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { parseDocument, stringify } from 'yaml';

/** Capture regular resources before writing anything, so links cannot redirect metadata writes. */
function readResources(root, prefix = '') {
  const directory = join(root, prefix);
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`Skill source must be a real directory: ${directory}`);
  const resources = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!prefix && entry.name === '.tensnap-skill.json') continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(root, path);
    if (entry.isDirectory()) resources.push(...readResources(root, path));
    else if (entry.isFile())
      resources.push({
        path,
        data: readFileSync(absolute),
        executable: !!(lstatSync(absolute).mode & 0o111),
      });
    else throw new Error(`Skill resource must be a regular file: ${absolute}`);
  }
  if (!resources.length)
    throw new Error(`Empty skill resource directory would be omitted by npm: ${directory}`);
  return resources;
}

/** Every local Markdown link must resolve inside the self-contained resource tree. */
function validateResourceLinks(resources) {
  const paths = new Set(resources.map(({ path }) => path));
  for (const resource of resources) {
    if (!resource.path.endsWith('.md')) continue;
    const text = resource.data.toString('utf8').replace(/```[\s\S]*?```/g, '');
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^(?:https?:|mailto:)/.test(link)) continue;
      const target = posix.join(posix.dirname(resource.path), link);
      if (posix.isAbsolute(link) || !paths.has(target))
        throw new Error(`Missing skill reference in ${resource.path}: ${link}`);
    }
  }
}

export function stampSkill(content, name, version) {
  const text = content.replace(/^\uFEFF/, '');
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!header) throw new Error(`Missing skill frontmatter: ${name}`);
  const document = parseDocument(header[1]);
  if (document.errors.length)
    throw new Error(`Invalid skill YAML: ${name}: ${document.errors[0].message}`);
  const fields = document.toJS();
  if (
    !fields ||
    typeof fields !== 'object' ||
    Array.isArray(fields) ||
    fields.name !== name ||
    typeof fields.description !== 'string' ||
    !fields.description.trim() ||
    fields.description.length > 1024
  )
    throw new Error(`Invalid skill name or description: ${name}`);
  if (
    fields.metadata !== undefined &&
    (!fields.metadata || typeof fields.metadata !== 'object' || Array.isArray(fields.metadata))
  )
    throw new Error(`Invalid skill metadata: ${name}`);
  fields.metadata = { ...fields.metadata, version };
  return {
    content: `---\n${stringify(fields, { lineWidth: 0 })}---\n${text.slice(header[0].length)}`,
    description: fields.description,
  };
}

export function bundleSkill(source, target, name, version) {
  const resources = readResources(source);
  validateResourceLinks(resources);
  const entrypoint = resources.find(({ path }) => path === 'SKILL.md');
  if (!entrypoint) throw new Error(`Missing SKILL.md: ${name}`);
  const stamped = stampSkill(entrypoint.data.toString('utf8'), name, version);
  entrypoint.data = Buffer.from(stamped.content);
  const files = Object.create(null);
  const executables = [];
  for (const resource of resources) {
    const output = join(target, resource.path);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, resource.data, { flag: 'wx' });
    chmodSync(output, resource.executable ? 0o755 : 0o644);
    files[resource.path] = createHash('sha256').update(resource.data).digest('hex');
    if (resource.executable) executables.push(resource.path);
  }
  return { name, description: stamped.description, files, executables };
}
