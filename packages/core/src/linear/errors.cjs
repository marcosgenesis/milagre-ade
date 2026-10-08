/** A Linear failure the UI can show as is. `code` says what the caller should do about it. */
class LinearError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "LinearError";
    this.code = code;
  }
}

module.exports = { LinearError };
