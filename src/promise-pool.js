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

module.exports = {
  promisePool,
};
