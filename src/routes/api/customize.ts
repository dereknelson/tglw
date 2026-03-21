import { createFileRoute } from '@tanstack/react-router'

const XAI_API_KEY = process.env.XAI_API_KEY || ''
const GROK_API_URL = 'https://api.x.ai/v1/images/edits'

// Cache the base design as base64
let baseDesignBase64: string | null = null

async function getBaseDesign(requestUrl: string): Promise<string> {
  if (!baseDesignBase64) {
    const origin = new URL(requestUrl).origin
    const res = await fetch(`${origin}/design.png`)
    const buffer = Buffer.from(await res.arrayBuffer())
    baseDesignBase64 = buffer.toString('base64')
  }
  return baseDesignBase64
}

export const Route = createFileRoute('/api/customize')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!XAI_API_KEY) {
          return Response.json(
            { error: 'Image customization is not configured yet' },
            { status: 503 },
          )
        }

        // Parse multipart form data
        let formData: FormData
        try {
          formData = await request.formData()
        } catch {
          return Response.json(
            { error: 'Expected multipart form data with a photo' },
            { status: 400 },
          )
        }

        const photo = formData.get('photo')
        if (!photo || !(photo instanceof File)) {
          return Response.json({ error: 'Missing photo file' }, { status: 400 })
        }

        // Validate file type
        if (!photo.type.startsWith('image/')) {
          return Response.json(
            { error: 'File must be an image' },
            { status: 400 },
          )
        }

        // Validate file size (max 10MB)
        if (photo.size > 10 * 1024 * 1024) {
          return Response.json(
            { error: 'Image must be under 10MB' },
            { status: 400 },
          )
        }

        // Convert uploaded photo to base64
        const photoBuffer = Buffer.from(await photo.arrayBuffer())
        const photoBase64 = photoBuffer.toString('base64')
        const photoMime = photo.type || 'image/jpeg'

        // Get base design as base64
        const designBase64 = await getBaseDesign(request.url)

        // Call Grok image edit API
        const grokRes = await fetch(GROK_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${XAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'grok-imagine-image',
            prompt:
              'I need you to edit <IMAGE_1> with MINIMAL changes. This is a t-shirt design of a muscular robot character lifting a barbell with grass on the weights, with text "TEXT CLAUDE." at top, "TOUCH GRASS." in the middle, and "LIFT WEIGHTS." at the bottom. DO NOT regenerate or redraw the image. Make ONE small edit: replace ONLY the robot\'s face/head with the face of the person in <IMAGE_0>, drawn in the same cartoon/comic illustration style. Keep the same exact dimensions and aspect ratio as <IMAGE_1>. Everything else must remain PIXEL-PERFECT identical: the full body, both legs (both feet visible touching the ground), both arms, the barbell, the grass weights, the dirt ground, the lightning bolts, all three lines of text, and the transparent background. Output as PNG with transparent background. Do not crop, resize, recompose, or zoom into the image.',
            images: [
              { url: `data:${photoMime};base64,${photoBase64}` },
              { url: `data:image/png;base64,${designBase64}` },
            ],
            n: 1,
            resolution: '2k',
            response_format: 'url',
          }),
        })

        if (!grokRes.ok) {
          const errText = await grokRes.text()
          console.error('Grok API error:', grokRes.status, errText)
          return Response.json(
            { error: 'Image generation failed. Please try again.' },
            { status: 502 },
          )
        }

        const grokData = (await grokRes.json()) as {
          data: Array<{ url?: string; b64_json?: string }>
        }

        const imageUrls = grokData.data
          .map((d) => d.url)
          .filter((u): u is string => !!u)
        if (imageUrls.length === 0) {
          return Response.json(
            { error: 'No image returned from generator' },
            { status: 502 },
          )
        }

        return Response.json({ imageUrls })
      },
    },
  },
})
