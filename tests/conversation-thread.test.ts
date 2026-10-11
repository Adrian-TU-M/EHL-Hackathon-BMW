import { describe, expect, it } from "vitest";
import { conversationMessages } from "../src/lib/council/conversation-thread";

describe("Jury conversation isolation", () => {
  const archive = [
    { id: "el-old-verdict-1", text: "Legacy chat" },
    { id: "jc:first:connection-a:PM:1", text: "Old question" },
    { id: "jc:second:connection-b:PM:1", text: "New question" },
    { id: "jc:second:connection-c:judge:1", text: "Reply after resuming" },
  ];
  it("starts a fresh thread without leaking earlier messages into context", () => {
    expect(conversationMessages(archive, "new-thread")).toEqual([]);
    expect(archive).toHaveLength(4);
  });
  it("continues only the chosen chat across reconnections", () => {
    expect(conversationMessages(archive, "second").map(m => m.text)).toEqual([
      "New question", "Reply after resuming",
    ]);
  });
  it("can still continue legacy history until the user chooses a fresh chat", () => {
    expect(conversationMessages(archive, null)).toEqual(archive);
  });
});
