/**
 * An outcome the caller can act on: a short code for programs and a sentence for people.
 * Anything else that goes wrong is reported as UNEXPECTED, without its details.
 */
export class WosBotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WosBotError';
    this.code = code;
  }
}
