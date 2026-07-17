// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lingui/react', () => ({
  useLingui: () => ({
    _: (value: unknown) => typeof value === 'string'
      ? value
      : (value as { message?: string; id?: string }).message ?? (value as { id?: string }).id ?? '',
  }),
}));

import { ValueInspector } from './ValueInspector';

describe('ValueInspector', () => {
  it('returns to a valid page when a high-frequency value shrinks', async () => {
    const { rerender } = render(<ValueInspector value={Array.from({ length: 101 }, (_, index) => index)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next value rows' }));
    expect(screen.getByText('101–101 / 101')).toBeInTheDocument();

    rerender(<ValueInspector value={[0]} />);

    await waitFor(() => {
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Previous value rows' })).toBeNull();
    });
  });

  it('virtualizes wide, paged tables instead of mounting every cell', () => {
    const rows = Array.from({ length: 100 }, (_, row) => Object.fromEntries(
      Array.from({ length: 64 }, (_, column) => [`column-${column}`, `${row}:${column}`]),
    ));

    render(<ValueInspector value={rows} renderHint="table" />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    const cells = screen.getAllByRole('cell');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(100 * 64);
  });

  it('coalesces a 120 Hz stream with 4 MiB custom data to its latest table frame', async () => {
    vi.useFakeTimers();
    try {
      const largeCustomData = 'x'.repeat(4 * 1024 * 1024);
      const { rerender } = render(<ValueInspector value={[{ largeCustomData, tick: 0 }]} renderHint="table" />);
      for (let tick = 1; tick <= 120; tick += 1) {
        rerender(<ValueInspector value={[{ largeCustomData, tick }]} renderHint="table" />);
      }

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      expect(screen.getByText('120')).toBeInTheDocument();
      expect(screen.queryByText(largeCustomData)).toBeNull();
      expect(screen.getAllByRole('cell').length).toBeLessThan(8);
    } finally {
      vi.useRealTimers();
    }
  });
});
