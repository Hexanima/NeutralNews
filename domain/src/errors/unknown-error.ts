import { TaggedError } from "../types/error.js";

export class UnknownError extends TaggedError<"UnknownError"> {
  constructor(message: string) {
    super("UnknownError");
    this.message = message;
  }
}
