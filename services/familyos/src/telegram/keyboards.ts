export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export function confirmKeyboard(prefix: string, token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Confirm", callback_data: `${prefix}:${token}:confirm` },
      { text: "Cancel", callback_data: `${prefix}:${token}:cancel` },
    ]],
  };
}

export function pagedPickerKeyboard(
  prefix: string,
  token: string,
  count: number,
  page: number,
  totalPages: number,
): InlineKeyboard {
  const numberRow = Array.from({ length: count }, (_value, index) => ({
    text: String(index + 1),
    callback_data: `${prefix}:${token}:pick:${index + 1}`,
  }));

  return {
    inline_keyboard: [
      numberRow,
      [
        { text: "Prev", callback_data: `${prefix}:${token}:prev` },
        { text: "Next", callback_data: `${prefix}:${token}:next` },
        { text: "Cancel", callback_data: `${prefix}:${token}:cancel` },
      ].filter((button) => totalPages > 1 || button.text === "Cancel"),
    ],
  };
}

export function treeKeyboard(token: string, count: number): InlineKeyboard {
  const buttons = Array.from({ length: count }, (_value, index) => ({
    text: String(index + 1),
    callback_data: `tree:${token}:pick:${index + 1}`,
  }));

  return {
    inline_keyboard: [
      buttons,
      [
        { text: "Default", callback_data: `tree:${token}:filter:default` },
        { text: "No-tools", callback_data: `tree:${token}:filter:no-tools` },
        { text: "User-only", callback_data: `tree:${token}:filter:user-only` },
      ],
      [
        { text: "Labeled-only", callback_data: `tree:${token}:filter:labeled-only` },
        { text: "All", callback_data: `tree:${token}:filter:all` },
      ],
      [
        { text: "Prev", callback_data: `tree:${token}:prev` },
        { text: "Next", callback_data: `tree:${token}:next` },
        { text: "Cancel", callback_data: `tree:${token}:cancel` },
      ],
    ],
  };
}

export function treeActionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Restore full context", callback_data: `tree-action:${token}:restore` },
      { text: "Branch with summary", callback_data: `tree-action:${token}:branch` },
      { text: "Cancel", callback_data: `tree-action:${token}:cancel` },
    ]],
  };
}

export function compactKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Compact now", callback_data: `compact:${token}:now` },
      { text: "Compact with custom instruction", callback_data: `compact:${token}:custom` },
      { text: "Cancel", callback_data: `compact:${token}:cancel` },
    ]],
  };
}

export function listKeyboard(prefix: string, token: string, labels: string[]): InlineKeyboard {
  return {
    inline_keyboard: labels.map((label, index) => [
      { text: label, callback_data: `${prefix}:${token}:pick:${index + 1}` },
    ]),
  };
}

export function modelActionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Switch anyway", callback_data: `model-action:${token}:switch_anyway` },
      { text: "Branch + compact, then switch", callback_data: `model-action:${token}:branch_compact_then_switch` },
      { text: "New session", callback_data: `model-action:${token}:new_session` },
      { text: "Cancel", callback_data: `model-action:${token}:cancel` },
    ]],
  };
}

export function agentActionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: "Continue current session", callback_data: `agent-action:${token}:continue_session` },
      { text: "Start fresh session", callback_data: `agent-action:${token}:start_fresh` },
      { text: "Branch with summary, then switch agent", callback_data: `agent-action:${token}:branch_then_switch` },
      { text: "Cancel", callback_data: `agent-action:${token}:cancel` },
    ]],
  };
}
