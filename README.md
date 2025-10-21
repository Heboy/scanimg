# scanimg

A CLI tool that scans source files for image URLs, fetches remote metadata, and reports the size and resolution of each asset.

## Features

- Recursively traverses the target directory (default: current working directory) to extract image URLs.
- Issues HEAD/Range requests to estimate remote file size and parse dimensions with a minimal payload.
- Displays the results in a table including index, URL, size, resolution, status, and occurrence count.
- Supports configurable concurrency and timeout to adapt to different network conditions.
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
```

If `--dir` is omitted, the current directory is scanned.

### CLI Options

| Option              | Default | Description                                   |
| ------------------- | ------- | --------------------------------------------- |
| `--dir <path>`      | `.`     | Directory or file to scan; may be repeated.   |
| `--timeout <ms>`    | `10000` | Request timeout in milliseconds.              |
| `--concurrency <n>` | `5`     | Maximum number of concurrent network requests.|
| `--help`, `-h`      | -       | Show usage information.                       |

## Sample Output

```
Scanning 12 images...

Index | URL                                         | Size     | Resolution | Status                       | Occurrences
----- | ------------------------------------------- | -------- | ---------- | ---------------------------- | -----------
1     | https://example.com/assets/banner@2x.png    | 1.54 MB  | 1440x900   | OK(HEAD); OK(Range)          | 3
2     | https://example.com/img/icon.svg            | -        | -          | HEAD 404; GET 404            | 1
3     | https://cdn.example.com/pic/avatar.webp     | 243.87 KB| 512x512    | OK(HEAD); OK(Range)          | 2

Done.
```

## Tips

- Run the tool on a stable network to minimize timeouts or 4xx/5xx failures.
- If a server denies `content-length` or range requests, the size may appear as `-`; consult the Status column for clues.
- Currently only remote URLs are analyzed; local image inspection can be added later if needed.

## License

MIT

