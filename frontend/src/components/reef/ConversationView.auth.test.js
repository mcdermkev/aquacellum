import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./ConversationView.jsx", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("ConversationView verified-session mutation boundary", () => {
  it("requires account plus Privy authentication before read or send mutations", () => {
    expect(SOURCE).toContain("const { account, authenticated } = useAuth();");
    expect(SOURCE).toContain("const canMutateConversation = !!account && !!authenticated;");

    const markEffectStart = SOURCE.indexOf("useEffect(() => {", SOURCE.indexOf("canMutateConversationRef"));
    const markEffect = SOURCE.slice(
      markEffectStart,
      SOURCE.indexOf("}, [conversationId]);", markEffectStart) + "}, [conversationId]);".length,
    );
    expect(markEffect.indexOf("if (conversationId && canMutateConversationRef.current)")).toBeGreaterThan(-1);
    expect(markEffect.indexOf("markReadRef.current(conversationId)")).toBeGreaterThan(
      markEffect.indexOf("if (conversationId && canMutateConversationRef.current)"),
    );

    const sendHandler = SOURCE.slice(SOURCE.indexOf("const handleSend"), SOURCE.indexOf("const composerEnabled"));
    expect(sendHandler.indexOf("if (!canMutateConversation || !conversationId")).toBeGreaterThan(-1);
    expect(sendHandler.indexOf("sendMutation.mutateAsync")).toBeGreaterThan(
      sendHandler.indexOf("if (!canMutateConversation || !conversationId"),
    );
  });

  it("does not replay read/send mutations when authentication changes", () => {
    expect(SOURCE).toContain("}, [conversationId]);");
    const authEffectStart = SOURCE.indexOf("useEffect(() => {", SOURCE.indexOf("}, [conversationId]);") + 1);
    const authEffect = SOURCE.slice(
      authEffectStart,
      SOURCE.indexOf("}, [canMutateConversation]);", authEffectStart) + "}, [canMutateConversation]);".length,
    );
    expect(authEffect).toContain('setInput("")');
    expect(authEffect).not.toContain("markRead");
    expect(authEffect).not.toContain("mutateAsync");
  });

  it("disables and explains the composer for unverified sessions", () => {
    expect(SOURCE).toContain("disabled={!composerEnabled}");
    expect(SOURCE).toContain("disabled={!sendEnabled}");
    expect(SOURCE).toContain('id="conversation-auth-status"');
    expect(SOURCE).toContain("Verified sign-in required to send messages");
  });
});
