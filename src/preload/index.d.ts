import type { WatchApi } from './index'

declare global {
  interface Window {
    watch: WatchApi
  }
}

export {}
