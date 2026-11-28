import { HttpTypes } from "@medusajs/types"
import { Container } from "@modules/common/components/ui"
import SafeImage from "@modules/common/components/safe-image"

type ImageGalleryProps = {
  images: HttpTypes.StoreProductImage[]
  title: string
}

const ImageGallery = ({ images, title }: ImageGalleryProps) => {
  return (
    <div className="flex items-start relative">
      <div className="flex flex-col flex-1 small:mx-16 gap-y-4">
        {images.map((image, index) => {
          return (
            <Container
              key={image.id}
              className="relative aspect-[29/34] w-full overflow-hidden bg-paper"
              id={image.id}
            >
              {!!image.url && (
                <SafeImage
                  src={image.url}
                  priority={index === 0}
                  className="absolute inset-0 rounded-rounded object-cover"
                  alt={`${title} image ${index + 1}`}
                  sizes="(min-width: 1024px) 50vw, 100vw"
                />
              )}
            </Container>
          )
        })}
      </div>
    </div>
  )
}

export default ImageGallery
