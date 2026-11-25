import { Button, Heading, Text } from "@modules/common/components/ui"

const Newsletter = ({ action }: { action: string | null }) => {
  if (!action) {
    return null
  }

  return (
    <section className="bg-paper py-12 small:py-24">
      <div className="content-container flex max-w-xl flex-col items-center gap-4 text-center">
        <Heading level="h2">Join our newsletter</Heading>
        <Text className="text-charcoal">
          New arrivals and offers, straight to your inbox.
        </Text>
        <form
          method="post"
          action={action}
          className="flex w-full flex-col gap-3 text-left small:flex-row small:items-end"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label
              htmlFor="newsletter-email"
              className="font-sans text-sm text-charcoal"
            >
              Email address
            </label>
            <input
              id="newsletter-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="min-h-[44px] w-full rounded-base border border-line-strong bg-ivory px-4 font-sans text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            />
          </div>
          <Button type="submit" size="large">
            Subscribe
          </Button>
        </form>
      </div>
    </section>
  )
}

export default Newsletter
