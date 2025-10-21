#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const process = require('process');
const imageSize = require('image-size');

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_CONCURRENCY = 5;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-thresh', 'build', 'coverage']);
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i;
const IMAGE_REF_REGEX = /[^\s"'`)(<>]+?\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:\?[^\s"'`)(<>]*)?/gi;

const hasNativeFetch = typeof global.fetch === 'function';

const ensureFetch = async () => {
  if (hasNativeFetch) {
    return global.fetch;
  }
  try {
    const { default: fetch } = await import('node-fetch');

    return fetch;
  } catch (error) {
    throw new Error('The current Node.js environment does not support fetch and the node-fetch dependency is not installed. Please upgrade to Node.js 18+ or install node-fetch manually.');
  }
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    dir: [],
    timeout: DEFAULT_TIMEOUT,
    concurrency: DEFAULT_CONCURRENCY,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--dir': {
        const next = args[i + 1];
        if (!next) {
          throw new Error('Invalid argument: --dir requires a directory or file path.');
        }
        options.dir.push(next);
        i += 1;
        break;
      }
      case '--timeout': {
        const next = Number(args[i + 1]);
        if (Number.isNaN(next) || next <= 0) {
          throw new Error('Invalid argument: --timeout must be a number greater than 0.');
        }
        options.timeout = next;
        i += 1;
        break;
      }
      case '--concurrency': {
        const next = Number(args[i + 1]);
        if (!Number.isInteger(next) || next <= 0) {
          throw new Error('Invalid argument: --concurrency must be an integer greater than 0.');
        }
        options.concurrency = next;
        i += 1;
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.dir.length) {
    options.dir.push('.');
  }

  return options;
};

const printHelp = () => {
  const help = `
scanimg --dir <path> [--dir <path> ...] [--timeout <ms>] [--concurrency <num>]

Options:
  --dir <path>          Specify directories or files to scan, can be provided multiple times (defaults to current directory)
  --timeout <ms>        Request timeout in milliseconds (default: 10000)
  --concurrency <num>   Number of concurrent requests (default: 5)
  --help, -h            Show help information
`.trim();

  console.log(help);
};

const walkFiles = async (inputPath, fileList = []) => {
  const stat = await fs.promises.stat(inputPath);

  if (stat.isDirectory()) {
    const dirName = path.basename(inputPath);
    if (IGNORED_DIRS.has(dirName)) {
      return fileList;
    }

    const entries = await fs.promises.readdir(inputPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(inputPath, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walkFiles(nextPath, fileList);
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
  const matches = content.match(IMAGE_REF_REGEX);
  if (!matches) {
    return [];
  }

  return matches
    .map((item) => item.trim())
    .filter((item) => IMAGE_EXT_PATTERN.test(item));
};

const classifyImageReference = (rawValue, sourceFile) => {
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

  let candidatePath = trimmedValue;

  if (/^file:\/\//i.test(candidatePath)) {
    try {
      const fileUrl = new URL(candidatePath);
      candidatePath = fileUrl.pathname;
      if (process.platform === 'win32' && candidatePath.startsWith('/')) {
        candidatePath = candidatePath.slice(1);
      }
      candidatePath = decodeURIComponent(candidatePath);
    } catch {
      candidatePath = candidatePath.replace(/^file:\/\//i, '');
    }
  }

  const cleanPath = candidatePath.replace(/[?#].*$/, '');
  const baseDir = path.dirname(sourceFile);
  const absolutePath = path.isAbsolute(cleanPath)
    ? cleanPath
    : path.resolve(baseDir, cleanPath);
  const normalizedPath = path.normalize(absolutePath);
  const display = path.relative(process.cwd(), normalizedPath) || normalizedPath;

  return {
    id: `local::${normalizedPath}`,
    type: 'local',
    request: normalizedPath,
    display,
  };
};

const readFileSafe = async (filePath) => {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    console.warn(`[scanimg] Failed to read file: ${filePath}. Skipped. Reason: ${error.message}`);

    return '';
  }
};

const collectImageTargets = async (srcPaths) => {
  const targetMap = new Map();

  for (const srcPath of srcPaths) {
    const absPath = path.resolve(srcPath);
    const files = await walkFiles(absPath);

    for (const file of files) {
      const content = await readFileSafe(file);
      if (!content) continue;

      const references = extractImageReferences(content);
      if (!references.length) continue;

      for (const reference of references) {
        const classified = classifyImageReference(reference, file);
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

const fetchWithTimeout = async (fetchImpl, url, options = {}) => {
  const controller = new AbortController();
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const RANGE_BYTES = 65_535;

const parseTotalFromContentRange = (contentRange) => {
  if (!contentRange) return null;
  const match = contentRange.match(/\/(\d+)\s*$/);
  if (match && match[1]) {
    const total = Number(match[1]);

    return Number.isNaN(total) ? null : total;
  }

  return null;
};

const parseNumber = (value) => {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const getRemoteImageMetadata = async (fetchImpl, url, timeout) => {
  const result = {
    target: url,
    size: null,
    status: 'Unknown',
    width: null,
    height: null,
  };

  const statusMessages = [];
  let headSucceeded = false;

  try {
    const headRes = await fetchWithTimeout(fetchImpl, url, {
      method: 'HEAD',
      timeout,
    });

    if (headRes.ok) {
      headSucceeded = true;
      statusMessages.push('OK(HEAD)');

      const parsedLength = parseNumber(headRes.headers.get('content-length'));
      if (parsedLength !== null) {
        result.size = parsedLength;
      }
    } else {
      statusMessages.push(`HEAD ${headRes.status}`);
    }
  } catch (error) {
    statusMessages.push(error.name === 'AbortError' ? 'HEAD timeout' : `HEAD failed: ${error.message}`);
  }

  try {
    const rangeRes = await fetchWithTimeout(fetchImpl, url, {
      method: 'GET',
      headers: {
        Range: `bytes=0-${RANGE_BYTES}`,
      },
      timeout,
    });

    if (!rangeRes.ok) {
      statusMessages.push(`GET ${rangeRes.status}`);

      result.status = statusMessages.join('; ') || 'Unknown';

      return result;
    }

    statusMessages.push(rangeRes.status === 206 ? 'OK(Range)' : 'OK(GET)');

    if (result.size == null) {
      const total = parseTotalFromContentRange(rangeRes.headers.get('content-range'));
      const parsedLength = parseNumber(rangeRes.headers.get('content-length'));

      if (typeof total === 'number') {
        result.size = total;
      } else if (rangeRes.status === 200 && parsedLength !== null) {
        result.size = parsedLength;
      }
    }

    const arrayBuffer = await rangeRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      const { width, height } = imageSize(buffer);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        result.width = width;
        result.height = height;
      } else {
        statusMessages.push('Failed to parse resolution');
      }
    } catch (error) {
      statusMessages.push(`Failed to parse resolution: ${error.message}`);
    }
  } catch (error) {
    statusMessages.push(error.name === 'AbortError' ? 'GET timeout' : `GET failed: ${error.message}`);
  }

  result.status = statusMessages.join('; ') || 'Unknown';

  return result;
};

const getLocalImageMetadata = async (absolutePath) => {
  const relativeTarget = path.relative(process.cwd(), absolutePath) || absolutePath;
  const result = {
    target: relativeTarget,
    size: null,
    status: 'Unknown',
    width: null,
    height: null,
  };

  const statusMessages = [];

  try {
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) {
      statusMessages.push('Not a file');
      result.status = statusMessages.join('; ') || 'Unknown';

      return result;
    }

    result.size = stat.size;
  } catch (error) {
    statusMessages.push(error.code === 'ENOENT' ? 'File not found' : `File access failed: ${error.message}`);
    result.status = statusMessages.join('; ') || 'Unknown';

    return result;
  }

  try {
    const { width, height } = imageSize(absolutePath);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      result.width = width;
      result.height = height;
    } else {
      statusMessages.push('Failed to parse resolution');
    }
  } catch (error) {
    statusMessages.push(`Failed to parse resolution: ${error.message}`);
  }

  if (!statusMessages.length) {
    statusMessages.push('OK(file)');
  }

  result.status = statusMessages.join('; ') || 'Unknown';

  return result;
};

const promisePool = async (items, concurrency, iterator) => {
  const results = [];
  const executing = [];

  for (const item of items) {
    const promise = Promise.resolve().then(() => iterator(item));
    results.push(promise);

    if (concurrency > 0) {
      const e = promise.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
};

const formatBytes = (bytes) => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
    return '-';
  }

  if (bytes === 0) {
    return '0 KB';
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(2)} KB`;
  }

  const mb = kb / 1024;

  return `${mb.toFixed(2)} MB`;
};

const formatResolution = (width, height) => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return '-';
  }

  return `${width}x${height}`;
};

const renderTable = (rows) => {
  if (!rows.length) {
    console.log('No images found.');

    return;
  }

  const tableData = rows.map((row, index) => ({
    Index: index + 1,
    Target: row.target,
    Type: row.type === 'remote' ? 'Remote' : 'Local',
    Size: formatBytes(row.size),
    Resolution: formatResolution(row.width, row.height),
    Status: row.status,
    Occurrences: row.occurrences,
  }));

  console.table(tableData);
};

const main = async () => {
  try {
    const options = parseArgs();

    const targetMap = await collectImageTargets(options.dir);

    if (!targetMap.size) {
      console.log('No images found within the provided paths.');
      return;
    }

    const targets = Array.from(targetMap.values());
    const hasRemoteTargets = targets.some((item) => item.type === 'remote');
    const fetchImpl = hasRemoteTargets ? await ensureFetch() : null;

    const spinnerInterval = startSpinner(`Inspecting ${targets.length} images...`);

    const results = await promisePool(
      targets,
      options.concurrency,
      async (item) => {
        if (item.type === 'remote') {
          const metadata = await getRemoteImageMetadata(fetchImpl, item.request, options.timeout);
          return {
            ...metadata,
            id: item.id,
            type: item.type,
            target: item.display,
          };
        }

        const metadata = await getLocalImageMetadata(item.request);

        return {
          ...metadata,
          id: item.id,
          type: item.type,
          target: item.display,
        };
      },
    );

    stopSpinner(spinnerInterval);

    const rows = results.map((item) => {
      const sources = targetMap.get(item.id)?.sources ?? new Set();

      return {
        ...item,
        occurrences: sources.size,
      };
    });

    const sortedRows = rows.sort((a, b) => {
      const sizeA = typeof a.size === 'number' ? a.size : -1;
      const sizeB = typeof b.size === 'number' ? b.size : -1;

      return sizeB - sizeA;
    });

    renderTable(sortedRows);
  } catch (error) {
    console.error(`Execution failed: ${error.message}`);
    process.exitCode = 1;
  }
};

main();

function startSpinner(message = 'Processing...') {
  const frames = ['-', '\\', '|', '/'];
  let index = 0;

  process.stdout.write(message);

  return setInterval(() => {
    process.stdout.write(`\r${message} ${frames[index % frames.length]}`);
    index += 1;
  }, 120);
}

function stopSpinner(intervalId) {
  if (!intervalId) return;
  clearInterval(intervalId);
  process.stdout.write('\rProcessing complete                          \n');
}
