// Sends an iMessage via osascript. Message text and recipient are passed as
// osascript argv (never interpolated into script source) to prevent
// AppleScript injection. Errors are classified into sanitized codes; raw
// stderr is preserved on SendError.localDetail for LOCAL logging only.
import { execFile } from "node:child_process";

export const SEND_SCRIPT = `on run argv
  set recipientAddr to item 1 of argv
  set msgText to item 2 of argv
  tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetParticipant to participant recipientAddr of targetService
    send msgText to targetParticipant
  end tell
end run`;

export class SendError extends Error {
  constructor(code, localDetail) {
    super(`iMessage send failed: ${code}`);
    this.name = "SendError";
    this.code = code;
    this.localDetail = localDetail;
  }
}

function classify(stderr) {
  if (/-1743|not authori[sz]ed/i.test(stderr)) return "AUTOMATION_NOT_AUTHORIZED";
  if (/service type|-1728|isn.t running|application .Messages./i.test(stderr)) {
    return "MESSAGES_UNAVAILABLE";
  }
  return "SEND_FAILED";
}

export function sendMessage({ recipient, text }, execFileFn = execFile) {
  return new Promise((resolve, reject) => {
    execFileFn(
      "osascript",
      ["-e", SEND_SCRIPT, recipient, text],
      { timeout: 30_000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new SendError(classify(stderr ?? ""), stderr ?? String(error)));
        } else {
          resolve();
        }
      },
    );
  });
}
