export class TypingIndicatorLoop {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly intervalMs: number) {}

  start(key: string, sendTyping: () => Promise<void>) {
    if (this.timers.has(key)) return;

    void sendTyping();
    const timer = setInterval(() => {
      void sendTyping();
    }, this.intervalMs);
    this.timers.set(key, timer);
  }

  stop(key: string) {
    const timer = this.timers.get(key);
    if (!timer) return;
    clearInterval(timer);
    this.timers.delete(key);
  }
}
