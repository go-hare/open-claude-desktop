type QueueItem = {
  uuid: string;
};

type QueueResolver<T> = (result: IteratorResult<T>) => void;

function completedResult<T>(): IteratorResult<T> {
  return { done: true, value: undefined };
}

export class CoworkAsyncInputQueue<
  T extends QueueItem,
> implements AsyncIterable<T> {
  private isDone = false;
  private readonly queue: T[] = [];
  private resolvers: Array<QueueResolver<T>> = [];

  enqueue(item: T): void {
    if (this.isDone) return;
    const resolver = this.resolvers.shift();
    if (resolver) resolver({ done: false, value: item });
    else this.queue.push(item);
  }

  remove(uuid: string): boolean {
    const index = this.queue.findIndex((item) => item.uuid === uuid);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    return true;
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  done(): void {
    this.isDone = true;
    for (const resolver of this.resolvers) resolver(completedResult());
    this.resolvers = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }

  private next(): Promise<IteratorResult<T>> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve({ done: false, value: queued });
    if (this.isDone) return Promise.resolve(completedResult());
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
}
