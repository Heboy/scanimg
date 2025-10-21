const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_IGNORED_DIRS = new Set(['node_modules', '.git']);
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i;
const IMAGE_REF_REGEX = /[^\s"'`)(<>]+?\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:\?[^\s"'`)(<>]*)?/gi;

module.exports = {
  DEFAULT_TIMEOUT,
  DEFAULT_CONCURRENCY,
  DEFAULT_IGNORED_DIRS,
  IMAGE_EXT_PATTERN,
  IMAGE_REF_REGEX,
};
