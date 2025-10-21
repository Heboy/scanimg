const startSpinner = (message = 'Processing...') => {
  if (!message) {
    return null;
  }

  const frames = ['-', '\\', '|', '/'];
  let index = 0;

  process.stdout.write(message);

  return setInterval(() => {
    process.stdout.write(`\r${message} ${frames[index % frames.length]}`);
    index += 1;
  }, 120);
};

const stopSpinner = (intervalId) => {
  if (!intervalId) return;
  clearInterval(intervalId);
  process.stdout.write('\rProcessing complete                          \n');
};

module.exports = {
  startSpinner,
  stopSpinner,
};
