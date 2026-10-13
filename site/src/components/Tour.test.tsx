// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tour } from './Tour'

afterEach(cleanup)

describe('Tour dialog', () => {
  it('is a modal that takes focus, keeps Tab inside, closes on Escape and gives focus back', () => {
    const opener = document.createElement('button')
    opener.textContent = 'open'
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const { rerender } = render(<Tour open onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Guided tour' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    // Tab from the last button wraps to the first; Shift+Tab from the first wraps to the last
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    buttons[buttons.length - 1].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    rerender(<Tour open={false} onClose={onClose} />)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
  it('steps forward and back with the progress announced', () => {
    render(<Tour open onClose={() => {}} />)
    expect(screen.getByText(/1 of 5/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/2 of 5/)).toBeTruthy()
    expect(screen.getByRole('img', { name: 'step 2 of 5' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText(/1 of 5/)).toBeTruthy()
  })
})
