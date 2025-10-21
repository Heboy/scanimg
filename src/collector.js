const fs = require('fs');
const path = require('path');
const { IMAGE_EXT_PATTERN, IMAGE_REF_REGEX } = require('./config');

const walkFiles = async (inputPath, ignoredDirs = new Set(), fileList = []) => {
  const stat = await fs.promises.stat(inputPath);

  if (stat.isDirectory()) {
    const dirName = path.basename(inputPath);
    if (ignoredDirs.has(dirName)) {
      return fileList;
    }

    const entries = await fs.promises.readdir(inputPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(inputPath, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          await walkFiles(nextPath, ignoredDirs, fileList);
        }
      } else if (entry.isFile()) {
        fileList.push(nextPath);
      }
    }
  } else if (stat.isFile()) {
    fileList.push(inputPath);
  }

  return fileList;
};

const extractImageReferences = (content) => {
  const regex = new RegExp(IMAGE_REF_REGEX.source, 'gi');
  const references = [];
  const boundaryIdentifier = /[0-9A-Za-z_$]/;

  for (const match of content.matchAll(regex)) {
    const value = match[0];
    if (!IMAGE_EXT_PATTERN.test(value)) continue;

    const start = match.index ?? content.indexOf(value);
    if (start === -1) continue;

    const end = start + value.length;
    const prevChar = start > 0 ? content[start - 1] : '';
    const nextChar = end < content.length ? content[end] : '';

    if (boundaryIdentifier.test(prevChar) || boundaryIdentifier.test(nextChar)) {
      continue;
    }

    if (value.includes('{') || value.includes('}')) {
      continue;
    }

    references.push(value.trim());
  }

  return references;
};

const classifyImageReference = (rawValue) => {
  if (!rawValue) {
    return null;
  }

  const trimmedValue = rawValue.trim();
  if (!trimmedValue) {
    return null;
  }

  if (/^data:/i.test(trimmedValue)) {
    return null;
  }

  const isHttpUrl = /^https?:\/\//i.test(trimmedValue);
  const isProtocolRelative = trimmedValue.startsWith('//');

  if (isHttpUrl || isProtocolRelative) {
    const normalized = isProtocolRelative ? `https:${trimmedValue}` : trimmedValue;

    return {
      id: `remote::${normalized}`,
      type: 'remote',
      request: normalized,
      display: normalized,
    };
  }

  return null;
};

const readFileSafe = async (filePath) => {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    console.warn(`[scanimg] Failed to read file: ${filePath}. Skipped. Reason: ${error.message}`);

    return '';
  }
};

const addLocalImageTarget = (targetMap, absolutePath) => {
  const normalizedPath = path.normalize(absolutePath);
  const display = path.relative(process.cwd(), normalizedPath) || normalizedPath;
  const id = `local::${normalizedPath}`;

  if (!targetMap.has(id)) {
    targetMap.set(id, {
      id,
      type: 'local',
      request: normalizedPath,
      display,
      sources: new Set([normalizedPath]),
    });
  } else {
    targetMap.get(id).sources.add(normalizedPath);
  }
};

const collectImageTargets = async (srcPaths, ignoredDirs) => {
  const targetMap = new Map();
  const activeIgnoredDirs = ignoredDirs ?? new Set();

  for (const srcPath of srcPaths) {
    const absPath = path.resolve(srcPath);
    const files = await walkFiles(absPath, activeIgnoredDirs);

    for (const file of files) {
      if (IMAGE_EXT_PATTERN.test(file)) {
        addLocalImageTarget(targetMap, file);

        continue;
      }

      const content = await readFileSafe(file);
      if (!content) continue;

      const references = extractImageReferences(content);
      if (!references.length) continue;

      for (const reference of references) {
        const classified = classifyImageReference(reference);
        if (!classified) continue;

        if (!targetMap.has(classified.id)) {
          targetMap.set(classified.id, {
            ...classified,
            sources: new Set(),
          });
        }
        targetMap.get(classified.id).sources.add(file);
      }
    }
  }

  return targetMap;
};

module.exports = {
  collectImageTargets,
};
