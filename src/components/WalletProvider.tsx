import { lazy, Suspense, useEffect, useState } from 'react'

const WalletProviderInner = lazy(() => import('./WalletProviderInner'))

export default function WalletProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <>{children}</>
  }

  return (
    <Suspense fallback={<>{children}</>}>
      <WalletProviderInner>{children}</WalletProviderInner>
    </Suspense>
  )
}
