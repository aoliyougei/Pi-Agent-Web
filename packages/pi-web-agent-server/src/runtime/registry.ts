export {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSession,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
  type SetRpcSessionToolsResult,
  setRpcSessionTools,
} from "./session-runtime.js";

export interface ManagedRuntime {
  isRunning(): boolean;
  close(): Promise<void>;
}

export class RuntimeRegistry<T extends ManagedRuntime = ManagedRuntime> {
  private readonly runtimes = new Map<string, T>();
  private readonly starts = new Map<string, Promise<T>>();

  get(id: string): T | undefined {
    return this.runtimes.get(id);
  }

  start(id: string, factory: () => Promise<T>): Promise<T> {
    const current = this.runtimes.get(id);
    if (current) return Promise.resolve(current);
    const starting = this.starts.get(id);
    if (starting) return starting;
    const promise = factory().then((runtime) => {
      this.runtimes.set(id, runtime);
      return runtime;
    }).finally(() => this.starts.delete(id));
    this.starts.set(id, promise);
    return promise;
  }

  async destroy(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    await runtime.close();
    this.runtimes.delete(id);
  }

  listRunning(): string[] {
    return [...this.runtimes].filter(([, runtime]) => runtime.isRunning()).map(([id]) => id);
  }
}
