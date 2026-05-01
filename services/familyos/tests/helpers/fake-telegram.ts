export class FakeTelegramResponder {
  sent: Array<{ text: string; parseMode?: string; keyboard?: any }> = [];
  edited: Array<{ messageId: number; text: string; parseMode?: string; keyboard?: any }> = [];
  callbackAnswers: string[] = [];
  typingCount = 0;

  async reply(text: string, options?: { parseMode?: string; keyboard?: any }) {
    this.sent.push({ text, parseMode: options?.parseMode, keyboard: options?.keyboard });
    return { messageId: this.sent.length };
  }

  async edit(messageId: number, text: string, options?: { parseMode?: string; keyboard?: any }) {
    this.edited.push({ messageId, text, parseMode: options?.parseMode, keyboard: options?.keyboard });
  }

  async answerCallback(text: string) {
    this.callbackAnswers.push(text);
  }

  async sendTyping() {
    this.typingCount += 1;
  }
}
