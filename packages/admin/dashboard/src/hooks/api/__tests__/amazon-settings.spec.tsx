// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock("../../../lib/client", () => ({
  sdk: { client: { fetch: (...args: unknown[]) => mockFetch(...args) } },
}))
vi.mock("../../../lib/query-client", async () => {
  const { QueryClient } = await vi.importActual<
    typeof import("@tanstack/react-query")
  >("@tanstack/react-query")
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 90000 } },
    }),
  }
})

import { queryClient } from "../../../lib/query-client"
import {
  amazonSettingsQueryKey,
  useAmazonSettings,
  useClearAmazonSettings,
  useSaveAmazonSettings,
  useTestAmazonSettings,
} from "../amazon-settings"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

afterEach(() => {
  queryClient.clear()
  mockFetch.mockReset()
  vi.restoreAllMocks()
})

describe("amazon settings hooks", () => {
  it("reads settings with GET under its query key", async () => {
    mockFetch.mockResolvedValue({ consumer_running: true })
    const { result } = renderHook(() => useAmazonSettings(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockFetch).toHaveBeenCalledWith("/admin/amazon-settings", {
      method: "GET",
    })
    expect(queryClient.getQueryData(amazonSettingsQueryKey)).toEqual({
      consumer_running: true,
    })
  })

  it("saves with POST and invalidates the settings", async () => {
    mockFetch.mockResolvedValue({})
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(() => useSaveAmazonSettings(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ aws_region: "eu-west-1" })
    })

    expect(mockFetch).toHaveBeenCalledWith("/admin/amazon-settings", {
      method: "POST",
      body: { aws_region: "eu-west-1" },
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: amazonSettingsQueryKey,
    })
  })

  it("clears with DELETE and invalidates the settings", async () => {
    mockFetch.mockResolvedValue({})
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(() => useClearAmazonSettings(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mockFetch).toHaveBeenCalledWith("/admin/amazon-settings", {
      method: "DELETE",
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: amazonSettingsQueryKey,
    })
  })

  it("tests with POST /test and does not invalidate", async () => {
    mockFetch.mockResolvedValue({ ok: true })
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(() => useTestAmazonSettings(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ sqs_queue_url: "https://q" })
    })

    expect(mockFetch).toHaveBeenCalledWith("/admin/amazon-settings/test", {
      method: "POST",
      body: { sqs_queue_url: "https://q" },
    })
    expect(invalidate).not.toHaveBeenCalled()
  })
})
