import type { PickerApi } from './picker'

declare global {
  interface Window {
    picker: PickerApi
  }
}

export {}
