export class AsyncMutex {
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  public async runExclusive<T>(work: () => T | Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    }).then(() => {
      this.locked = true;
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }
}
