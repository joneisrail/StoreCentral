import { escapeLike } from "../utils"

describe("escapeLike", () => {
  it("escapes backslash, percent and underscore", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\")
  })

  it("leaves plain text alone", () => {
    expect(escapeLike("Acme")).toBe("Acme")
  })
})
