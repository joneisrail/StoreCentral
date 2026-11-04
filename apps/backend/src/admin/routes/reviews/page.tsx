import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Table, Tabs, Text } from "@medusajs/ui"
import { sdk } from "../../lib/sdk"

type AdminReview = {
  id: string
  rating: number
  title: string
  comment: string
  status: "pending" | "approved" | "rejected"
  created_at: string
  product: { id: string; title: string } | null
  customer: { id: string; email: string } | null
}

type AdminReviewsResponse = {
  reviews: AdminReview[]
  count: number
  offset: number
  limit: number
}

type StatusFilter = "all" | "pending" | "approved" | "rejected"

const LIMIT = 20
const COMMENT_TRUNCATE_LENGTH = 80

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
]

// Task 4c: the empty state must name the tab, not use one generic string
// for every filter.
const EMPTY_STATE_TEXT: Record<StatusFilter, string> = {
  all: "No reviews found.",
  pending: "No pending reviews.",
  approved: "No approved reviews.",
  rejected: "No rejected reviews.",
}

function truncateComment(comment: string): string {
  if (comment.length <= COMMENT_TRUNCATE_LENGTH) {
    return comment
  }
  return `${comment.slice(0, COMMENT_TRUNCATE_LENGTH - 1)}…`
}

function mutationErrorMessage(error: unknown, action: "approve" | "reject") {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return `Failed to ${action} the review.`
}

const ReviewsPage = () => {
  const [status, setStatus] = useState<StatusFilter>("pending")
  const [offset, setOffset] = useState(0)
  const [mutatingReviewId, setMutatingReviewId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "reviews", status, offset],
    queryFn: () => {
      const query: Record<string, unknown> = { offset, limit: LIMIT }
      if (status !== "all") {
        query.status = status
      }
      return sdk.client.fetch<AdminReviewsResponse>("/admin/reviews", { query })
    },
  })

  const invalidateReviews = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "reviews"] })

  const approveReview = useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/reviews/${id}/approve`, { method: "POST" }),
    onMutate: (id: string) => {
      setMutatingReviewId(id)
      setMutationError(null)
    },
    onSuccess: invalidateReviews,
    onError: (error: unknown) => {
      setMutationError(mutationErrorMessage(error, "approve"))
    },
    onSettled: () => setMutatingReviewId(null),
  })

  const rejectReview = useMutation({
    mutationFn: (id: string) =>
      sdk.client.fetch(`/admin/reviews/${id}/reject`, { method: "POST" }),
    onMutate: (id: string) => {
      setMutatingReviewId(id)
      setMutationError(null)
    },
    onSuccess: invalidateReviews,
    onError: (error: unknown) => {
      setMutationError(mutationErrorMessage(error, "reject"))
    },
    onSettled: () => setMutatingReviewId(null),
  })

  const handleTabChange = (value: string) => {
    setStatus(value as StatusFilter)
    setOffset(0)
  }

  return (
    <Container>
      <Heading level="h1">Reviews</Heading>

      <Tabs value={status} onValueChange={handleTabChange}>
        <Tabs.List>
          {STATUS_TABS.map((tab) => (
            <Tabs.Trigger key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs>

      {isLoading && <Text>Loading...</Text>}

      {isError && (
        <div>
          <Text>Something went wrong loading reviews.</Text>
          <Button variant="secondary" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {mutationError && <Text className="text-ui-fg-error">{mutationError}</Text>}

      {!isLoading && !isError && data && data.reviews.length === 0 && (
        <Text>{EMPTY_STATE_TEXT[status]}</Text>
      )}

      {!isLoading && !isError && data && data.reviews.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Product</Table.HeaderCell>
              <Table.HeaderCell>Customer</Table.HeaderCell>
              <Table.HeaderCell>Rating</Table.HeaderCell>
              <Table.HeaderCell>Title</Table.HeaderCell>
              <Table.HeaderCell>Comment</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Date</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.reviews.map((review) => {
              const isMutatingThisRow = mutatingReviewId === review.id

              return (
                <Table.Row key={review.id}>
                  <Table.Cell>{review.product?.title ?? "—"}</Table.Cell>
                  <Table.Cell>{review.customer?.email ?? "—"}</Table.Cell>
                  <Table.Cell>{review.rating}</Table.Cell>
                  <Table.Cell>{review.title}</Table.Cell>
                  <Table.Cell>
                    <span title={review.comment}>
                      {truncateComment(review.comment)}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge>{review.status}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    {new Date(review.created_at).toLocaleDateString()}
                  </Table.Cell>
                  <Table.Cell>
                    {review.status === "pending" && (
                      <div>
                        <Button
                          variant="secondary"
                          disabled={isMutatingThisRow}
                          onClick={() => approveReview.mutate(review.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          disabled={isMutatingThisRow}
                          onClick={() => rejectReview.mutate(review.id)}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      )}

      {/* Task 4a: pagination controls render whenever a result set exists,
          regardless of whether the current page has rows, so approving or
          rejecting the last review(s) on page 2+ never strands the
          moderator on an empty page with no way back. */}
      {!isLoading && !isError && data && (
        <div>
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={offset + LIMIT >= data.count}
            onClick={() => setOffset(offset + LIMIT)}
          >
            Next
          </Button>
        </div>
      )}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Reviews",
})

export default ReviewsPage
