# scanimg

A CLI tool that scans source files for image references (remote URLs or local paths), inspects each asset, and reports the size and resolution.

## Features

- Recursively traverses the target directory (default: current working directory) to extract remote image references and locate local image files on disk (ignoring `.git` and `node_modules` by default, configurable via `--ignore`).
- Supports both remote image URLs (via source parsing) and local image files (via direct file system scan).
- Issues HEAD/Range requests to estimate remote file size and parse dimensions with a minimal payload.
- Displays the results in a table including index, target, size, resolution, status, type, and occurrence count.
- Supports configurable concurrency and timeout to adapt to different workloads.
- Shows a spinner while requests are in progress, providing instant feedback.

## Requirements

- Node.js ≥ 18 (built-in `fetch`).  
  For older Node versions, install `node-fetch` and adjust the script if necessary.

## Installation

```bash
pnpm install
# or
yarn install
# or
npm install
```

## Usage

```bash
npx scanimg --dir ./src --dir ./docs
# exclude build output
npx scanimg --dir . --ignore dist --ignore coverage
```

If `--dir` is omitted, the current directory is scanned.

### CLI Options

| Option              | Default | Description                                   |
| ------------------- | ------- | --------------------------------------------- |
| `--dir <path>`      | `.`     | Directory or file to scan; may be repeated.   |
| `--timeout <ms>`    | `10000` | Request timeout in milliseconds (remote only).|
| `--concurrency <n>` | `5`     | Maximum number of concurrent inspections.     |
| `--ignore <name>`   | `['.git', 'node_modules']` | Directory name to ignore during traversal (match by folder name); may be repeated. |
| `--help`, `-h`      | -       | Show usage information.                       |

## Sample Output

```
Inspecting 12 images...

Index | Target                                      | Type   | Size     | Resolution | Status                       | Occurrences
----- | ------------------------------------------- | ------ | -------- | ---------- | ---------------------------- | -----------
1     | https://example.com/assets/banner@2x.png    | Remote | 1.54 MB  | 1440x900   | OK(HEAD); OK(Range)          | 3
2     | public/images/logo.svg                      | Local  | 17.20 KB | 320x80     | OK(file)                     | 4
3     | https://cdn.example.com/pic/avatar.webp     | Remote | 243.87 KB| 512x512    | OK(HEAD); OK(Range)          | 2

Done.
```

## Tips

- Run the tool on a stable network to minimize timeouts or 4xx/5xx failures.
- If a server denies `content-length` or range requests, the size may appear as `-`; consult the Status column for clues.
- Ensure local paths resolve relative to the referencing source file or supply absolute paths when necessary.
- Use `--ignore` to skip build artifacts or backup folders so unrelated images stay out of the report.

## License

MIT
