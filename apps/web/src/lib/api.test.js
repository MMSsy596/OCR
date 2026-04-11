import { describe, expect, it } from "vitest";
import { readApiErrorMessage } from "./api";

describe("readApiErrorMessage", () => {
  it("đọc được detail từ response JSON", async () => {
    const response = new Response(JSON.stringify({ detail: "file_too_large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readApiErrorMessage(response, "fallback")).resolves.toBe("file_too_large");
  });

  it("fallback về message gốc khi error không phải JSON", async () => {
    await expect(
      readApiErrorMessage(new Error("network_timeout"), "fallback"),
    ).resolves.toBe("network_timeout");
  });
});
