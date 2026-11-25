import { Container } from "@modules/common/components/ui"

const SkeletonProductPreview = () => {
  return (
    <div className="motion-safe:animate-pulse">
      <Container className="aspect-[4/5] w-full bg-line" />
      <div className="flex justify-between text-base-regular mt-2">
        <div className="w-2/5 h-6 bg-line"></div>
        <div className="w-1/5 h-6 bg-line"></div>
      </div>
    </div>
  )
}

export default SkeletonProductPreview
