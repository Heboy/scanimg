#!/usr/bin/env node

/**
 * CLI: 扫描代码中的图片 URL，并尝试获取远程资源的体积及分辨率。
 *
 * 使用方式：
 *   scanimg --dir ./src2 --dir ./docs
 *
 * 选项：
 *   --dir <path>  指定需要扫描的目录或文件，可以多次传入。若不传，默认扫描当前目录。
 *   --timeout <ms> 请求图片资源的超时时间，默认 10000 毫秒。
 *   --concurrency <num> 同时请求远程资源的最大数量，默认 5。
 */

const fs = require('fs');
const path = require('path');
const process = require('process');
const imageSize = require('image-size');

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_CONCURRENCY = 5;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-thresh', 'build', 'coverage']);
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i;
const IMAGE_URL_REGEX = /https?:\/\/[^\s"'`)(<>]+?\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:\?[^\s"'`)(<>]*)?/gi;

const hasNativeFetch = typeof global.fetch === 'function';

const ensureFetch = async () => {
  if (hasNativeFetch) {
    return global.fetch;
  }
  try {
    const { default: fetch } = await import('node-fetch');

    return fetch;
  } catch (error) {
    throw new Error('当前 Node.js 环境不支持 fetch，且未安装 node-fetch 依赖。请升级到 Node.js 18+ 或手动安装 node-fetch。');
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
          throw new Error('参数错误：--dir 需要指定目录或文件路径');
        }
        options.dir.push(next);
        i += 1;
        break;
      }
      case '--timeout': {
        const next = Number(args[i + 1]);
        if (Number.isNaN(next) || next <= 0) {
          throw new Error('参数错误：--timeout 需要是大于 0 的数字');
        }
        options.timeout = next;
        i += 1;
        break;
      }
      case '--concurrency': {
        const next = Number(args[i + 1]);
        if (!Number.isInteger(next) || next <= 0) {
          throw new Error('参数错误：--concurrency 需要是大于 0 的整数');
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
        throw new Error(`未知参数：${arg}`);
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

选项说明：
  --dir <path>          指定扫描的目录或文件，可重复多次传入（默认当前目录）
  --timeout <ms>        请求超时时间，默认 10000 毫秒
  --concurrency <num>   并发请求数，默认 5
  --help, -h            查看帮助
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

const extractImageUrls = (content) => {
  const matches = content.match(IMAGE_URL_REGEX);
  if (!matches) {
    return [];
  }

  return matches
    .map((item) => item.trim())
    .filter((item) => IMAGE_EXT_PATTERN.test(item));
};

const readFileSafe = async (filePath) => {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    console.warn(`[scanimg] 无法读取文件：${filePath}，已跳过。原因：${error.message}`);

    return '';
  }
};

const collectUrls = async (srcPaths) => {
  const urlMap = new Map();

  for (const srcPath of srcPaths) {
    const absPath = path.resolve(srcPath);
    const files = await walkFiles(absPath);

    for (const file of files) {
      const content = await readFileSafe(file);
      if (!content) continue;

      const urls = extractImageUrls(content);
      if (!urls.length) continue;

      for (const url of urls) {
        if (!urlMap.has(url)) {
          urlMap.set(url, new Set());
        }
        urlMap.get(url).add(file);
      }
    }
  }

  return urlMap;
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
    url,
    size: null,
    status: '未知',
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
    statusMessages.push(error.name === 'AbortError' ? 'HEAD超时' : `HEAD失败: ${error.message}`);
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

      result.status = statusMessages.join('; ') || '未知';

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
        statusMessages.push('分辨率解析失败');
      }
    } catch (error) {
      statusMessages.push(`分辨率解析失败: ${error.message}`);
    }
  } catch (error) {
    statusMessages.push(error.name === 'AbortError' ? 'GET超时' : `GET失败: ${error.message}`);
  }

  result.status = statusMessages.join('; ') || '未知';

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
    console.log('未找到任何图片 URL。');

    return;
  }

  const tableData = rows.map((row, index) => ({
    Index: index + 1,
    URL: row.url,
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

    const urlMap = await collectUrls(options.dir);

    if (!urlMap.size) {
      console.log('未在指定范围内找到任何图片 URL。');
      return;
    }

    const fetchImpl = await ensureFetch();
    const urls = Array.from(urlMap.keys());

    const spinnerInterval = startSpinner(`共 ${urls.length} 张图片，开始请求...`);

    const results = await promisePool(
      urls,
      options.concurrency,
      async (url) => getRemoteImageMetadata(fetchImpl, url, options.timeout),
    );

    stopSpinner(spinnerInterval);

    const rows = results.map((item) => {
      const sources = urlMap.get(item.url) || new Set();

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
    console.error(`执行失败：${error.message}`);
    process.exitCode = 1;
  }
};

main();

function startSpinner(message = '处理中...') {
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
  process.stdout.write('\r处理完成                          \n');
}
