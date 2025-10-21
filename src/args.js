const process = require('process');
const { DEFAULT_TIMEOUT, DEFAULT_CONCURRENCY, DEFAULT_IGNORED_DIRS } = require('./config');

const printHelp = () => {
  const help = `
scanimg --dir <path> [--dir <path> ...] [--timeout <ms>] [--concurrency <num>]

Options:
  --dir <path>          Specify directories or files to scan, can be provided multiple times (defaults to current directory)
  --timeout <ms>        Request timeout in milliseconds (default: 10000)
  --concurrency <num>   Number of concurrent requests (default: 5)
  --ignore <name>       Directory name to ignore during traversal (can be repeated)
  --help, -h            Show help information
`.trim();

  console.log(help);
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    dir: [],
    timeout: DEFAULT_TIMEOUT,
    concurrency: DEFAULT_CONCURRENCY,
    ignore: new Set(DEFAULT_IGNORED_DIRS),
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
      case '--ignore': {
        const next = args[i + 1];
        if (!next) {
          throw new Error('Invalid argument: --ignore requires a directory name.');
        }
        options.ignore.add(next);
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

module.exports = {
  parseArgs,
  printHelp,
};
