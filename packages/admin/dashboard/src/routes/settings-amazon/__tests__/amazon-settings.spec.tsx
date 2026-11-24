// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.message !== undefined) {
        return `${key}|${opts.message}`
      }
      return key
    },
  }),
}))

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  save: vi.fn(),
  test: vi.fn(),
  clear: vi.fn(),
  prompt: vi.fn(),
  refetch: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@medusajs/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@medusajs/ui")>("@medusajs/ui")
  return { ...actual, toast: mocks.toast, usePrompt: () => mocks.prompt }
})

vi.mock("../../../hooks/api/amazon-settings", () => ({
  useAmazonSettings: () => mocks.query,
  useSaveAmazonSettings: () => ({
    mutateAsync: mocks.save,
    isPending: false,
  }),
  useTestAmazonSettings: () => ({
    mutateAsync: mocks.test,
    isPending: false,
  }),
  useClearAmazonSettings: () => ({
    mutateAsync: mocks.clear,
    isPending: false,
  }),
}))

import { Component as AmazonSettingsPage } from ".."

const settings = (over: Record<string, unknown> = {}) => ({
  aws_region: { value: "us-east-1", source: "database" },
  sqs_queue_url: { value: "https://sqs.example/q", source: "environment" },
  lwa_client_id: { value: null, source: "none" },
  aws_access_key_id: { set: true, source: "database" },
  aws_secret_access_key: { set: true, source: "environment" },
  lwa_client_secret: { set: false, source: "none" },
  consumer_running: true,
  ...over,
})

const ok = (data: Record<string, unknown> = settings()) => {
  mocks.query = { data, isError: false, refetch: mocks.refetch }
}

const input = (label: string) =>
  screen.getByLabelText(`amazonSettings.fields.${label}`) as HTMLInputElement

beforeEach(() => {
  mocks.save.mockResolvedValue({})
  mocks.clear.mockResolvedValue({})
  ok()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("AmazonSettingsPage", () => {
  it("renders sources and Set badges and never a secret value", () => {
    render(<AmazonSettingsPage />)

    expect(input("awsRegion").value).toBe("us-east-1")
    expect(input("sqsQueueUrl").value).toBe("https://sqs.example/q")
    expect(screen.getAllByText("amazonSettings.source.database").length).toBe(2)
    expect(
      screen.getAllByText("amazonSettings.source.environment").length
    ).toBe(2)
    expect(screen.getAllByText("amazonSettings.source.none").length).toBe(2)
    // Two secrets are set, the third is not.
    expect(screen.getAllByText("amazonSettings.set").length).toBe(2)

    for (const label of [
      "awsAccessKeyId",
      "awsSecretAccessKey",
      "lwaClientSecret",
    ]) {
      const field = input(label)
      expect(field.type).toBe("password")
      expect(field.value).toBe("")
      expect(field.placeholder).toBe("amazonSettings.leaveBlank")
    }
  })

  it("save is disabled until a field changed", () => {
    render(<AmazonSettingsPage />)
    const save = screen.getByRole("button", { name: "actions.save" })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input("awsRegion"), { target: { value: "eu-west-1" } })
    expect((save as HTMLButtonElement).disabled).toBe(false)
  })

  it("save sends only changed fields", async () => {
    render(<AmazonSettingsPage />)
    fireEvent.change(input("awsRegion"), { target: { value: "eu-west-1" } })
    fireEvent.change(input("awsSecretAccessKey"), {
      target: { value: "new-secret" },
    })
    fireEvent.click(screen.getByRole("button", { name: "actions.save" }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith({
      aws_region: "eu-west-1",
      aws_secret_access_key: "new-secret",
    })
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "amazonSettings.toast.saved"
      )
    )
  })

  it("test sends only non-blank values and shows success", async () => {
    mocks.test.mockResolvedValue({ ok: true })
    render(<AmazonSettingsPage />)
    fireEvent.click(screen.getByRole("button", { name: "amazonSettings.test" }))

    await waitFor(() => expect(mocks.test).toHaveBeenCalledTimes(1))
    expect(mocks.test).toHaveBeenCalledWith({
      aws_region: "us-east-1",
      sqs_queue_url: "https://sqs.example/q",
    })
    expect(await screen.findByText("amazonSettings.testPassed")).toBeTruthy()
    // The page says LWA is not covered by the test.
    expect(screen.getByText("amazonSettings.testHint")).toBeTruthy()
  })

  it("test shows each failure message", async () => {
    for (const code of [
      "not_configured",
      "invalid_credentials",
      "queue_not_found",
      "access_denied",
      "unreachable",
    ]) {
      mocks.test.mockResolvedValue({
        ok: false,
        code,
        message: `message for ${code}`,
      })
      render(<AmazonSettingsPage />)
      fireEvent.click(
        screen.getByRole("button", { name: "amazonSettings.test" })
      )
      expect(await screen.findByText(`message for ${code}`)).toBeTruthy()
      cleanup()
    }
  })

  it("clear asks for confirmation", async () => {
    mocks.prompt.mockResolvedValueOnce(false)
    render(<AmazonSettingsPage />)
    const button = screen.getByRole("button", {
      name: "amazonSettings.clear",
    })

    fireEvent.click(button)
    await waitFor(() => expect(mocks.prompt).toHaveBeenCalledTimes(1))
    expect(mocks.clear).not.toHaveBeenCalled()

    mocks.prompt.mockResolvedValueOnce(true)
    fireEvent.click(button)
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledTimes(1))
  })

  it("load error banner shows no stale values", () => {
    mocks.query = {
      data: settings(),
      isError: true,
      error: { status: 502, message: "seller-hub is down" },
      refetch: mocks.refetch,
    }
    render(<AmazonSettingsPage />)

    expect(
      screen.getByText("amazonSettings.loadError|seller-hub is down")
    ).toBeTruthy()
    expect(screen.queryByDisplayValue("us-east-1")).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()

    fireEvent.click(
      screen.getByRole("button", { name: "amazonSettings.retry" })
    )
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it("422 shows field error next to the named field", async () => {
    mocks.save.mockRejectedValue({
      status: 422,
      message: "Unprocessable Entity",
      fields: ["aws_region"],
      kind: "invalid",
    })
    render(<AmazonSettingsPage />)
    fireEvent.change(input("awsRegion"), { target: { value: "bad" } })
    fireEvent.click(screen.getByRole("button", { name: "actions.save" }))

    expect(await screen.findByText("amazonSettings.fieldInvalid")).toBeTruthy()
    expect(input("awsRegion").getAttribute("aria-invalid")).toBe("true")
    expect(input("sqsQueueUrl").getAttribute("aria-invalid")).toBeNull()
  })

  it("status line running and not running", () => {
    render(<AmazonSettingsPage />)
    expect(screen.getByText("amazonSettings.status.running")).toBeTruthy()
    cleanup()

    ok(settings({ consumer_running: false }))
    render(<AmazonSettingsPage />)
    expect(screen.getByText("amazonSettings.status.notRunning")).toBeTruthy()
  })
})
