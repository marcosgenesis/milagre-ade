// One quit attempt at a time. A failed save keeps the process alive for retry.
function createQuitHandler({ prepare, quit, failed }) {
  let pending;
  return () =>
    (pending ??= Promise.resolve()
      .then(prepare)
      .then(quit, failed)
      .finally(() => {
        pending = null;
      }));
}
module.exports = { createQuitHandler };
