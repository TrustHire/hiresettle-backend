import { cursorPage } from "./cursor-pagination";

describe("cursorPage", () => {
  it("returns a cursor when more items are available", () => {
    expect(
      cursorPage([{ id: "one" }, { id: "two" }, { id: "three" }], 2),
    ).toEqual({
      data: [{ id: "one" }, { id: "two" }],
      nextCursor: "two",
    });
  });

  it("returns no cursor on the final page", () => {
    expect(cursorPage([{ id: "one" }], 2)).toEqual({
      data: [{ id: "one" }],
      nextCursor: null,
    });
  });
});
