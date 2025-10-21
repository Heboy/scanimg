const fs = require('fs');
const path = require('path');
const imageSize = require('image-size');
const { DEFAULT_TIMEOUT } = require('./config');

const hasNativeFetch = typeof global.fetch === 'function';

const ensureFetch = async () => {
  if (hasNativeFetch) {
    return global.fetch;
  }
  try {
    const { default: fetch } = await import('node-fetch');

    return fetch;
  } catch (error) {
    throw new Error(
      'The current Node.js environment does not support fetch and the node-fetch dependency is not installed. Please upgrade to Node.js 18+ or install node-fetch manually.',
    );
  }
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

module.exports = {
  ensureFetch,
  getRemoteImageMetadata,
  getLocalImageMetadata,
};
