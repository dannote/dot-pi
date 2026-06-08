import { describe, expect, test } from "bun:test";
import { appendQuote, formatQuote } from "./quote";

describe("formatQuote", () => {
  test("adds email-style quote prefix to every line", () => {
    expect(formatQuote("hello\nworld")).toBe("> hello\n> world");
  });

  test("normalizes CRLF and keeps blank quoted lines", () => {
    expect(formatQuote(" hello\r\n\r\nworld\r\n")).toBe("> hello\n>\n> world");
  });
});

describe("appendQuote", () => {
  test("appends quote to an empty editor", () => {
    expect(appendQuote("", "> hello")).toBe("> hello\n\n");
  });

  test("separates existing text from quote", () => {
    expect(appendQuote("comment", "> hello")).toBe("comment\n\n> hello\n\n");
  });

  test("preserves existing trailing newline with one extra spacer", () => {
    expect(appendQuote("comment\n", "> hello")).toBe("comment\n\n> hello\n\n");
  });
});
