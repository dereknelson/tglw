interface TshirtMockupProps {
  designUrl: string
  alt?: string
}

export default function TshirtMockup({ designUrl, alt = 'T-shirt design' }: TshirtMockupProps) {
  return (
    <div className="tshirt-frame float" style={{ width: '100%', maxWidth: 520, margin: '0 auto' }}>
      <img src="/black-tee.png" alt="Black tank top" className="tshirt-base" />
      <img src={designUrl} alt={alt} className="tshirt-design" />
    </div>
  )
}
