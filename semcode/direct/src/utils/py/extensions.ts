declare interface Promise<T> {
  // Catches task error and ignores them.
  ignoreErrors(): void;
}

/* eslint-disable @typescript-eslint/no-empty-function */
// Explicitly tells that promise should be run asynchronously.
Promise.prototype.ignoreErrors = function <T>(this: Promise<T>) {
  this.catch(() => {});
};
