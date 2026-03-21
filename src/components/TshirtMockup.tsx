interface TshirtMockupProps {
  designUrl: string
  alt?: string
}

export default function TshirtMockup({ designUrl, alt = 'T-shirt design' }: TshirtMockupProps) {
  return (
    <div className="tshirt-frame float" style={{ width: '100%' }}>
      <svg viewBox="0 0 400 460" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* T-shirt silhouette */}
        <path
          d="M120 40 L80 60 L20 100 L40 150 L80 130 L80 420 C80 435 90 445 105 445 L295 445 C310 445 320 435 320 420 L320 130 L360 150 L380 100 L320 60 L280 40 C270 70 240 90 200 90 C160 90 130 70 120 40Z"
          fill="#1a1a1a"
          stroke="#111"
          strokeWidth="2"
        />
        {/* Collar */}
        <path
          d="M120 40 C130 70 160 90 200 90 C240 90 270 70 280 40"
          fill="none"
          stroke="#333"
          strokeWidth="2"
        />
      </svg>
      <img src={designUrl} alt={alt} className="rounded-sm" />
    </div>
  )
}
