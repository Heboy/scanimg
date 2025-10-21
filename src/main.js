const process = require('process');
const { parseArgs } = require('./args');
const { collectImageTargets } = require('./collector');
const { ensureFetch, getRemoteImageMetadata, getLocalImageMetadata } = require('./metadata');
const { promisePool } = require('./promise-pool');
const { renderTable } = require('./render');
const { startSpinner, stopSpinner } = require('./spinner');

const run = async () => {
  try {
    const options = parseArgs();

    const targetMap = await collectImageTargets(options.dir, options.ignore);

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

module.exports = {
  run,
};
