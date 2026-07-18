export abstract class TaggedError<T extends string = string> extends Error {
  tag: T;

  constructor(errorTag: T) {
    super();
    this.tag = errorTag;
  }
}
