import pruneOrderEvents, { config } from "../prune-order-events"

describe("prune-order-events job", () => {
  afterEach(() => jest.useRealTimers())

  it("deletes events older than two years", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-15T03:00:00Z"))
    const pruneOlderThan = jest.fn().mockResolvedValue(7)
    const logger = { info: jest.fn() }
    const container: any = {
      resolve: (key: string) =>
        key === "orderEvents" ? { pruneOlderThan } : logger,
    }

    await pruneOrderEvents(container)

    expect(pruneOlderThan).toHaveBeenCalledTimes(1)
    const cutoff: Date = pruneOlderThan.mock.calls[0][0]
    expect(cutoff.getFullYear()).toBe(2024)
    expect(cutoff.getMonth()).toBe(10)
    expect(cutoff.getDate()).toBe(15)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("7"))
    expect(config.schedule).toBe("0 3 * * *")
  })
})
