import { readJsonFile, writeJsonAtomic } from "../json-file.js";
import type { ResolvedUser, UserState } from "../types.js";

export class StateStore {
  async read(user: ResolvedUser, defaultAgentId: string): Promise<UserState> {
    return readJsonFile(user.statePath, { activeAgentId: defaultAgentId });
  }

  async write(user: ResolvedUser, state: UserState): Promise<void> {
    await writeJsonAtomic(user.statePath, state);
  }
}
