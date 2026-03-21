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
              'Replace the face of the robot character in <IMAGE_1> with the face from the photo in <IMAGE_0>. Keep the exact same cartoon/illustration art style, body, pose, text, and all other elements identical. Only change the face to match the person in <IMAGE_0>, rendered in the same cartoon style.',
            images: [
              { url: `data:${photoMime};base64,${photoBase64}` },
              { url: `data:image/png;base64,${designBase64}` },
            ],
            n: 1,
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

        const imageUrl = grokData.data[0]?.url
        if (!imageUrl) {
          return Response.json(
            { error: 'No image returned from generator' },
            { status: 502 },
          )
        }

        return Response.json({ imageUrl })
      },
    },
  },
})
