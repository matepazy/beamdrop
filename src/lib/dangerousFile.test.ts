import { describe, expect, it } from 'vitest'

import { isPotentiallyDangerousFile } from './dangerousFile'

describe('isPotentiallyDangerousFile', () => {
  it.each(['setup.EXE', 'invoice.docm', 'bundle.zip', 'photo.svg'])('flags %s', (name) => {
    expect(isPotentiallyDangerousFile(name)).toBe(true)
  })

  it.each(['photo.jpg', 'notes.txt', 'report.pdf.txt', 'no-extension'])('does not flag %s', (name) => {
    expect(isPotentiallyDangerousFile(name)).toBe(false)
  })
})
