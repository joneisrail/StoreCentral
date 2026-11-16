import { SingleColumnPage } from "../../../components/layout/pages"
import { ChannelGrid } from "./components/channel-grid"

export const ChannelPricing = () => {
  return (
    <SingleColumnPage widgets={{ before: [], after: [] }}>
      <ChannelGrid />
    </SingleColumnPage>
  )
}
