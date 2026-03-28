import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_DIR = join(homedir(), '.config', 'tglw-buy')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export interface BuyerConfig {
  stripeSecretKey?: string
  paymentMethod?: string
  shipping?: {
    name: string
    address1: string
    city: string
    state: string
    zip: string
    country: string
  }
}

export async function loadConfig(): Promise<BuyerConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export async function saveConfig(config: BuyerConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2))
}
