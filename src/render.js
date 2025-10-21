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

  const headers = ['Index', 'Target', 'Type', 'Size', 'Resolution', 'Status', 'Occurrences'];
  const tableData = rows.map((row, index) => [
    String(index + 1),
    row.target,
    row.type === 'remote' ? 'Remote' : 'Local',
    formatBytes(row.size),
    formatResolution(row.width, row.height),
    row.status,
    String(row.occurrences),
  ]);

  const allRows = [headers, ...tableData];
  const columnWidths = headers.map((_, columnIndex) =>
    allRows.reduce((max, row) => Math.max(max, (row[columnIndex] ?? '').length), 0),
  );

  const formatRow = (row) =>
    row
      .map((cell, index) => {
        const content = cell ?? '';
        return content.padEnd(columnWidths[index], ' ');
      })
      .join(' | ');

  const separator = columnWidths.map((width) => '-'.repeat(width || 1)).join('-+-');

  console.log(formatRow(headers));
  console.log(separator);
  for (const row of tableData) {
    console.log(formatRow(row));
  }
};

module.exports = {
  renderTable,
};
